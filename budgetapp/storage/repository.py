import hashlib
import sqlite3
import threading
from decimal import Decimal
from pathlib import Path
from typing import Optional

import pandas as pd

from budgetapp.core.models import Account, Category, Transaction
from budgetapp.storage.database import get_connection, init_db


def _tx_id(date: str, description: str, amount: str, account_id: str) -> str:
    raw = f"{date}|{description}|{amount}|{account_id}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


class Repository:
    def __init__(self, db_path: Path):
        self._db_path = db_path
        self._local = threading.local()
        # Run migrations once at startup (connection closed after GC)
        init_db(db_path)

    @property
    def conn(self) -> sqlite3.Connection:
        # Each thread gets its own connection; WAL mode keeps them in sync
        if not hasattr(self._local, 'conn'):
            self._local.conn = get_connection(self._db_path)
        return self._local.conn

    # ------------------------------------------------------------------
    # Transactions
    # ------------------------------------------------------------------

    def upsert_transactions(self, df: pd.DataFrame, user: str = "dave") -> int:
        """Insert parsed DataFrame rows; skip duplicates. Returns count inserted."""
        rows = []
        for _, row in df.iterrows():
            date_str = row["date"].isoformat()
            amount_str = str(row["amount"])
            tx_id = _tx_id(date_str, row["description"], amount_str, row["account_id"])
            cat = row.get("category_id") if "category_id" in df.columns else None
            if not isinstance(cat, str):
                cat = None  # coerce NaN / None
            rows.append((
                tx_id,
                date_str,
                row["description"],
                row["raw_description"],
                amount_str,
                row["account_id"],
                cat,
                user,
            ))

        before = self.conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
        self.conn.executemany(
            """INSERT OR IGNORE INTO transactions
               (id, date, description, raw_description, amount, account_id, category_id, user)
               VALUES (?,?,?,?,?,?,?,?)""",
            rows,
        )
        self.conn.commit()
        after = self.conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
        return after - before

    def get_transactions(
        self,
        account_id: Optional[str] = None,
        month: Optional[str] = None,   # "YYYY-MM"
    ) -> list[Transaction]:
        query = "SELECT * FROM transactions WHERE 1=1"
        params: list = []
        if account_id:
            query += " AND account_id = ?"
            params.append(account_id)
        if month:
            query += " AND date LIKE ?"
            params.append(f"{month}-%")
        query += " ORDER BY date"

        rows = self.conn.execute(query, params).fetchall()
        return [self._row_to_transaction(r) for r in rows]

    def set_category(self, tx_id: str, category_id: str) -> None:
        row = self.conn.execute(
            "SELECT category_id, amount, description FROM transactions WHERE id = ?", (tx_id,)
        ).fetchone()
        self.conn.execute("UPDATE transactions SET category_id = ? WHERE id = ?", (category_id, tx_id))
        if row:
            amount = Decimal(row["amount"])
            if row["category_id"]:
                self._adjust_linked_balance(row["category_id"], -amount)
            if category_id:
                self._adjust_linked_balance(category_id, amount)
                if row["description"]:
                    self._learn_rule(row["description"], category_id)
        self.conn.commit()

    def _adjust_linked_balance(self, category_id: str, amount: Decimal) -> None:
        debt = self.conn.execute(
            "SELECT id, balance FROM debts WHERE category_id = ?", (category_id,)
        ).fetchone()
        if debt and debt["balance"]:
            new_bal = max(Decimal("0"), Decimal(debt["balance"]) + amount)
            self.conn.execute("UPDATE debts SET balance = ? WHERE id = ?",
                              (str(new_bal), debt["id"]))

        sav = self.conn.execute(
            "SELECT id, balance FROM savings_trackers WHERE category_id = ?", (category_id,)
        ).fetchone()
        if sav:
            # Negate: a transfer OUT of checking is negative, but increases savings balance
            new_bal = Decimal(sav["balance"] or "0") - amount
            self.conn.execute("UPDATE savings_trackers SET balance = ? WHERE id = ?",
                              (str(new_bal), sav["id"]))

    def _learn_rule(self, description: str, category_id: str) -> None:
        import re
        pattern = re.escape(description)
        existing = self.conn.execute(
            "SELECT id, category_id FROM categorization_rules WHERE pattern = ?", (pattern,)
        ).fetchone()
        if existing:
            if existing["category_id"] != category_id:
                self.conn.execute(
                    "UPDATE categorization_rules SET category_id = ? WHERE id = ?",
                    (category_id, existing["id"]),
                )
        else:
            self.conn.execute(
                "INSERT INTO categorization_rules (pattern, category_id, priority) VALUES (?,?,?)",
                (pattern, category_id, 20),
            )

    # ------------------------------------------------------------------
    # Categories
    # ------------------------------------------------------------------

    def get_categories(self) -> list[Category]:
        rows = self.conn.execute("SELECT * FROM categories ORDER BY bucket, name").fetchall()
        return [self._row_to_category(r) for r in rows]

    def set_category_budget(self, category_id: str, budget_amount: str | None) -> None:
        cleaned = budget_amount.replace(",", ".") if budget_amount else None
        try:
            stored = str(Decimal(cleaned)) if cleaned else None
        except Exception:
            stored = None
        self.conn.execute(
            "UPDATE categories SET budget_amount = ? WHERE id = ?",
            (stored, category_id),
        )
        self.conn.commit()

    def delete_category(self, cat_id: str) -> None:
        in_use = self.conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE category_id = ?", (cat_id,)
        ).fetchone()[0]
        if in_use:
            raise ValueError(f"Cannot delete: {in_use} transaction(s) still use this category.")
        self.conn.execute("DELETE FROM categories WHERE id = ?", (cat_id,))
        self.conn.commit()

    def upsert_category(self, cat: Category) -> None:
        self.conn.execute(
            """INSERT INTO categories (id, name, bucket, owner, budget_amount)
               VALUES (?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, bucket=excluded.bucket,
                 owner=excluded.owner, budget_amount=excluded.budget_amount""",
            (cat.id, cat.name, cat.bucket, cat.owner,
             str(cat.budget_amount) if cat.budget_amount is not None else None),
        )
        self.conn.commit()

    # ------------------------------------------------------------------
    # Categorization rules
    # ------------------------------------------------------------------

    def get_rules(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM categorization_rules ORDER BY priority DESC"
        ).fetchall()
        return [{k: r[k] for k in r.keys()} for r in rows]

    # ------------------------------------------------------------------
    # Accounts
    # ------------------------------------------------------------------

    def get_accounts(self) -> list[Account]:
        rows = self.conn.execute("SELECT * FROM accounts").fetchall()
        return [Account(**{k: r[k] for k in r.keys()}) for r in rows]

    def upsert_account(self, id: str, name: str, bank: str, account_type: str, owner: str) -> None:
        self.conn.execute(
            """INSERT INTO accounts (id, name, bank, account_type, owner) VALUES (?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, bank=excluded.bank,
                 account_type=excluded.account_type, owner=excluded.owner""",
            (id, name, bank, account_type, owner),
        )
        self.conn.commit()

    def delete_account(self, account_id: str) -> None:
        in_use = self.conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE account_id = ?", (account_id,)
        ).fetchone()[0]
        if in_use:
            raise ValueError(f"Cannot delete: {in_use} transaction(s) use this account.")
        self.conn.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
        self.conn.commit()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _row_to_transaction(self, row: sqlite3.Row) -> Transaction:
        from datetime import date
        d = {k: row[k] for k in row.keys()}
        d["date"] = date.fromisoformat(d["date"])
        d["amount"] = Decimal(d["amount"])
        return Transaction(**d)

    # ------------------------------------------------------------------
    # Debts
    # ------------------------------------------------------------------

    def get_debts(self) -> list[dict]:
        rows = self.conn.execute("SELECT * FROM debts ORDER BY name").fetchall()
        return [{k: r[k] for k in r.keys()} for r in rows]

    def upsert_debt(self, id: str, name: str, balance: str | None, apr: str | None,
                    minimum: str | None, months_remaining: int | None = None) -> None:
        self.conn.execute(
            """INSERT INTO debts (id, name, balance, apr, minimum, months_remaining) VALUES (?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, balance=excluded.balance,
                 apr=excluded.apr, minimum=excluded.minimum,
                 months_remaining=excluded.months_remaining""",
            (id, name, balance or None, apr or None, minimum or None, months_remaining),
        )
        self.conn.commit()

    def link_debt_category(self, debt_id: str, category_id: str | None) -> None:
        self.conn.execute(
            "UPDATE debts SET category_id = ? WHERE id = ?", (category_id or None, debt_id)
        )
        self.conn.commit()

    def get_savings_trackers(self) -> list[dict]:
        rows = self.conn.execute("SELECT * FROM savings_trackers ORDER BY name").fetchall()
        return [{k: r[k] for k in r.keys()} for r in rows]

    def upsert_savings_tracker(self, id: str, name: str, balance: str, category_id: str | None) -> None:
        self.conn.execute(
            """INSERT INTO savings_trackers (id, name, balance, category_id) VALUES (?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, balance=excluded.balance, category_id=excluded.category_id""",
            (id, name, balance or "0", category_id or None),
        )
        self.conn.commit()

    def delete_savings_tracker(self, id: str) -> None:
        self.conn.execute("DELETE FROM savings_trackers WHERE id = ?", (id,))
        self.conn.commit()

    def delete_debt(self, id: str) -> None:
        self.conn.execute("DELETE FROM debts WHERE id = ?", (id,))
        self.conn.commit()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _row_to_category(self, row: sqlite3.Row) -> Category:
        d = {k: row[k] for k in row.keys()}
        if d["budget_amount"]:
            d["budget_amount"] = Decimal(d["budget_amount"])
        else:
            d["budget_amount"] = None
        return Category(**d)
