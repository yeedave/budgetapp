import hashlib
import sqlite3
from decimal import Decimal
from pathlib import Path
from typing import Optional

import pandas as pd

from budgetapp.core.models import Account, Category, Transaction
from budgetapp.storage.database import init_db


def _tx_id(date: str, description: str, amount: str, account_id: str) -> str:
    raw = f"{date}|{description}|{amount}|{account_id}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


class Repository:
    def __init__(self, db_path: Path):
        self.conn = init_db(db_path)

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
            rows.append((
                tx_id,
                date_str,
                row["description"],
                row["raw_description"],
                amount_str,
                row["account_id"],
                None,   # category_id — filled by categorizer
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
        self.conn.execute(
            "UPDATE transactions SET category_id = ? WHERE id = ?",
            (category_id, tx_id),
        )
        self.conn.commit()

    # ------------------------------------------------------------------
    # Categories
    # ------------------------------------------------------------------

    def get_categories(self) -> list[Category]:
        rows = self.conn.execute("SELECT * FROM categories ORDER BY bucket, name").fetchall()
        return [self._row_to_category(r) for r in rows]

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
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Accounts
    # ------------------------------------------------------------------

    def get_accounts(self) -> list[Account]:
        rows = self.conn.execute("SELECT * FROM accounts").fetchall()
        return [Account(**dict(r)) for r in rows]

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _row_to_transaction(self, row: sqlite3.Row) -> Transaction:
        from datetime import date
        d = dict(row)
        d["date"] = date.fromisoformat(d["date"])
        d["amount"] = Decimal(d["amount"])
        return Transaction(**d)

    def _row_to_category(self, row: sqlite3.Row) -> Category:
        d = dict(row)
        if d["budget_amount"] is not None:
            d["budget_amount"] = Decimal(d["budget_amount"])
        return Category(**d)
