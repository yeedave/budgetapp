import hashlib
import sqlite3
import threading
from decimal import Decimal
from pathlib import Path
from typing import Optional

import pandas as pd

from budgetapp.core.models import Account, Category, Transaction
from budgetapp.storage.database import get_connection, init_db


def _tx_id(date: str, description: str, amount: str, account_id: str, seq: int = 0) -> str:
    raw = f"{date}|{description}|{amount}|{account_id}|{seq}"
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
        seen_ids: set[str] = set()  # IDs used so far in this batch
        for _, row in df.iterrows():
            date_str = row["date"].isoformat()
            amount_str = str(row["amount"])
            # Increment seq until we find an ID not already used in this batch.
            # seq=0 is backward-compatible with previously imported transactions.
            seq = 0
            tx_id = _tx_id(date_str, row["description"], amount_str, row["account_id"], seq)
            while tx_id in seen_ids:
                seq += 1
                tx_id = _tx_id(date_str, row["description"], amount_str, row["account_id"], seq)
            seen_ids.add(tx_id)
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

        # Identify which rows with categories are genuinely new before the insert
        rows_with_cat = [(tx_id, amount_str, account_id, cat)
                         for tx_id, _, _, _, amount_str, account_id, cat, _ in rows if cat]
        if rows_with_cat:
            placeholders = ','.join('?' * len(rows_with_cat))
            existing_ids = {
                r[0] for r in self.conn.execute(
                    f"SELECT id FROM transactions WHERE id IN ({placeholders})",
                    [r[0] for r in rows_with_cat],
                ).fetchall()
            }
            new_with_cat = [(tx_id, amount_str, account_id, cat)
                            for tx_id, amount_str, account_id, cat in rows_with_cat
                            if tx_id not in existing_ids]
        else:
            new_with_cat = []

        before = self.conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
        self.conn.executemany(
            """INSERT OR IGNORE INTO transactions
               (id, date, description, raw_description, amount, account_id, category_id, user)
               VALUES (?,?,?,?,?,?,?,?)""",
            rows,
        )
        after = self.conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]

        # Fire balance adjustments for newly inserted rows (savings split + debt tracking on import)
        acct_type_cache: dict[str, str] = {}
        for _, amount_str, account_id, cat in new_with_cat:
            if account_id not in acct_type_cache:
                r = self.conn.execute("SELECT account_type FROM accounts WHERE id = ?", (account_id,)).fetchone()
                acct_type_cache[account_id] = r["account_type"] if r else ""
            from_sav = acct_type_cache[account_id] == "savings"
            self._adjust_linked_balance(cat, Decimal(amount_str), from_sav)

        self.conn.commit()
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

    def update_transaction_amount(self, tx_id: str, amount: str) -> None:
        self.conn.execute(
            "UPDATE transactions SET amount = ? WHERE id = ? AND is_manual = 1",
            (amount, tx_id),
        )
        self.conn.commit()

    def set_category(self, tx_id: str, category_id: str) -> list[str]:
        """Set category on one transaction, auto-apply rule to matching uncategorized ones.
        Returns list of all tx_ids updated."""
        row = self.conn.execute(
            """SELECT t.category_id, t.amount, t.description, a.account_type
               FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id
               WHERE t.id = ?""",
            (tx_id,),
        ).fetchone()
        self.conn.execute("UPDATE transactions SET category_id = ? WHERE id = ?", (category_id or None, tx_id))
        updated_ids = [tx_id]
        if row:
            amount = Decimal(row["amount"])
            from_sav = (row["account_type"] or "") == "savings"
            if row["category_id"]:
                self._adjust_linked_balance(row["category_id"], -amount, from_sav)
            if category_id:
                self._adjust_linked_balance(category_id, amount, from_sav)
                if row["description"]:
                    self._learn_rule(row["description"], category_id)
                    # Apply to all other uncategorized transactions with the same description
                    matching = self.conn.execute(
                        """SELECT t.id, t.amount, a.account_type
                           FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id
                           WHERE t.id != ? AND t.category_id IS NULL
                             AND t.description = ? COLLATE NOCASE""",
                        (tx_id, row["description"]),
                    ).fetchall()
                    for m in matching:
                        self.conn.execute(
                            "UPDATE transactions SET category_id = ? WHERE id = ?",
                            (category_id, m["id"]),
                        )
                        self._adjust_linked_balance(
                            category_id, Decimal(m["amount"]),
                            (m["account_type"] or "") == "savings",
                        )
                        updated_ids.append(m["id"])
        self.conn.commit()
        return updated_ids

    def _adjust_linked_balance(self, category_id: str, amount: Decimal,
                               from_savings_account: bool = False) -> None:
        debt = self.conn.execute(
            "SELECT id, balance FROM debts WHERE category_id = ?", (category_id,)
        ).fetchone()
        if debt and debt["balance"]:
            new_bal = max(Decimal("0"), Decimal(debt["balance"]) + amount)
            self.conn.execute("UPDATE debts SET balance = ? WHERE id = ?",
                              (str(new_bal), debt["id"]))

        savs = self.conn.execute(
            "SELECT id, balance, monthly_contribution FROM savings_trackers WHERE category_id = ?",
            (category_id,)
        ).fetchall()

        # Direction logic:
        #   Checking outflow (amount < 0, from_savings_account=False):
        #     negate so -750 becomes +750 credit to savings
        #   Savings inflow (amount > 0, from_savings_account=True):
        #     use directly — +50 interest is already a +50 credit
        #   Undo cases use the opposite sign of amount, so the formula stays consistent.
        def _credit(bal: Decimal, mc: Decimal | None = None) -> Decimal:
            if mc is not None:
                # Split group: fixed contribution per tracker
                sign = (Decimal("1") if amount > 0 else Decimal("-1")) if from_savings_account \
                       else (Decimal("1") if amount < 0 else Decimal("-1"))
                return bal + mc * sign
            if from_savings_account:
                return bal + amount   # interest/deposit: add directly
            return bal - amount       # checking outflow: negate

        if len(savs) == 1:
            sav = savs[0]
            new_bal = _credit(Decimal(sav["balance"] or "0"))
            self.conn.execute("UPDATE savings_trackers SET balance = ? WHERE id = ?",
                              (str(new_bal), sav["id"]))
        elif len(savs) > 1:
            for sav in savs:
                if not sav["monthly_contribution"]:
                    continue
                new_bal = _credit(Decimal(sav["balance"] or "0"), Decimal(sav["monthly_contribution"]))
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
            """SELECT r.id, r.pattern, r.category_id, r.priority,
                      c.name AS category_name
               FROM categorization_rules r
               LEFT JOIN categories c ON r.category_id = c.id
               ORDER BY r.priority DESC, r.id""",
        ).fetchall()
        return [{k: r[k] for k in r.keys()} for r in rows]

    def create_rule(self, pattern: str, category_id: str, priority: int = 10) -> dict:
        cursor = self.conn.execute(
            "INSERT INTO categorization_rules (pattern, category_id, priority) VALUES (?,?,?)",
            (pattern, category_id, priority),
        )
        self.conn.commit()
        return {"id": cursor.lastrowid, "pattern": pattern,
                "category_id": category_id, "priority": priority}

    def delete_rule(self, rule_id: int) -> None:
        self.conn.execute("DELETE FROM categorization_rules WHERE id = ?", (rule_id,))
        self.conn.commit()

    # ------------------------------------------------------------------
    # Accounts
    # ------------------------------------------------------------------

    def get_accounts(self) -> list[Account]:
        rows = self.conn.execute(
            "SELECT * FROM accounts ORDER BY COALESCE(sort_order, 9999), name"
        ).fetchall()
        result = []
        for r in rows:
            d = {k: r[k] for k in r.keys()}
            # Gracefully handle DBs that haven't migrated yet
            result.append(Account(
                id=d["id"], name=d["name"], bank=d["bank"],
                account_type=d["account_type"], owner=d["owner"],
                color=d.get("color"), sort_order=d.get("sort_order"),
            ))
        return result

    def upsert_account(self, id: str, name: str, bank: str, account_type: str, owner: str,
                       color: str | None = None) -> None:
        self.conn.execute(
            """INSERT INTO accounts (id, name, bank, account_type, owner, color) VALUES (?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, bank=excluded.bank,
                 account_type=excluded.account_type, owner=excluded.owner,
                 color=COALESCE(excluded.color, color)""",
            (id, name, bank, account_type, owner, color),
        )
        self.conn.commit()

    def save_account_order(self, ids: list[str]) -> None:
        for i, account_id in enumerate(ids):
            self.conn.execute(
                "UPDATE accounts SET sort_order = ? WHERE id = ?", (i, account_id)
            )
        self.conn.commit()

    def save_account_color(self, account_id: str, color: str | None) -> None:
        self.conn.execute(
            "UPDATE accounts SET color = ? WHERE id = ?", (color, account_id)
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

    def get_orphaned_account_ids(self) -> list[dict]:
        """Return account_ids that appear in transactions but have no accounts row."""
        rows = self.conn.execute("""
            SELECT t.account_id, COUNT(*) AS tx_count
            FROM transactions t
            LEFT JOIN accounts a ON t.account_id = a.id
            WHERE a.id IS NULL
            GROUP BY t.account_id
            ORDER BY t.account_id
        """).fetchall()
        return [{"account_id": r["account_id"], "tx_count": r["tx_count"]} for r in rows]

    def delete_transactions_for_account(self, account_id: str) -> int:
        """Delete all transactions for an orphaned account_id. Returns deleted count."""
        result = self.conn.execute(
            "DELETE FROM transactions WHERE account_id = ?", (account_id,)
        )
        self.conn.commit()
        return result.rowcount

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def add_manual_transaction(
        self, date_str: str, description: str, amount_str: str,
        account_id: str, category_id: str | None,
    ) -> Transaction:
        from datetime import date as date_type
        tx_id = _tx_id(date_str, description, amount_str, account_id)
        self.conn.execute(
            """INSERT OR IGNORE INTO transactions
               (id, date, description, raw_description, amount, account_id, category_id, user, is_manual)
               VALUES (?,?,?,?,?,?,?,?,1)""",
            (tx_id, date_str, description, description, amount_str, account_id, category_id or None, "dave"),
        )
        self.conn.commit()
        row = self.conn.execute("SELECT * FROM transactions WHERE id = ?", (tx_id,)).fetchone()
        return self._row_to_transaction(row)

    def delete_transaction(self, tx_id: str) -> None:
        self.conn.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
        self.conn.commit()

    def find_duplicate_transactions(self) -> list[dict]:
        # Pull all transactions where (date, amount) has multiple entries.
        # Description similarity is handled in Python to support case-insensitive
        # and prefix matching (e.g. "STARBUCKS" vs "STARBUCKS #1234 CA").
        rows = self.conn.execute(
            """SELECT t.rowid, t.id, t.date, t.description, t.amount,
                      t.account_id, t.category_id
               FROM transactions t
               INNER JOIN (
                   SELECT date, amount
                   FROM transactions
                   GROUP BY date, amount
                   HAVING COUNT(*) > 1
               ) dup ON t.date = dup.date AND t.amount = dup.amount
               ORDER BY t.date, t.amount, t.rowid"""
        ).fetchall()

        def _desc_similar(a: str, b: str) -> bool:
            a, b = a.lower().strip(), b.lower().strip()
            if a == b:
                return True
            # One description is a prefix of the other (min 5 chars to avoid
            # false positives on short strings like "ACH" or "ATM").
            short, long = (a, b) if len(a) <= len(b) else (b, a)
            return len(short) >= 5 and long.startswith(short)

        from collections import defaultdict
        by_date_amount: dict[tuple, list[dict]] = defaultdict(list)
        for r in rows:
            key = (str(r["date"]), str(r["amount"]))
            by_date_amount[key].append({k: r[k] for k in r.keys()})

        result = []
        for txs in by_date_amount.values():
            # Cluster transactions whose descriptions are similar
            clusters: list[list[dict]] = []
            for tx in txs:
                placed = False
                for cluster in clusters:
                    if _desc_similar(tx["description"], cluster[0]["description"]):
                        cluster.append(tx)
                        placed = True
                        break
                if not placed:
                    clusters.append([tx])
            for cluster in clusters:
                if len(cluster) > 1:
                    rep = cluster[0]
                    result.append({
                        "key": [str(rep["date"]), rep["description"], str(rep["amount"])],
                        "transactions": cluster,
                    })

        return result

    def delete_transactions_by_ids(self, ids: list[str]) -> int:
        if not ids:
            return 0
        placeholders = ",".join("?" * len(ids))
        self.conn.execute(f"DELETE FROM transactions WHERE id IN ({placeholders})", ids)
        self.conn.commit()
        return len(ids)

    def count_transactions_range(self, start_date: str, end_date: str,
                                 account_id: str | None = None) -> int:
        if account_id:
            return self.conn.execute(
                "SELECT COUNT(*) FROM transactions WHERE date >= ? AND date <= ? AND account_id = ?",
                (start_date, end_date, account_id),
            ).fetchone()[0]
        return self.conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE date >= ? AND date <= ?",
            (start_date, end_date),
        ).fetchone()[0]

    def delete_transactions_range(self, start_date: str, end_date: str,
                                  account_id: str | None = None) -> int:
        before = self.conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
        if account_id:
            self.conn.execute(
                "DELETE FROM transactions WHERE date >= ? AND date <= ? AND account_id = ?",
                (start_date, end_date, account_id),
            )
        else:
            self.conn.execute(
                "DELETE FROM transactions WHERE date >= ? AND date <= ?",
                (start_date, end_date),
            )
        after = self.conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
        self.conn.commit()
        return before - after

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
                    minimum: str | None, months_remaining: int | None = None) -> dict:
        """Returns {'xp_earned': float, 'is_payoff': bool}."""
        from datetime import datetime as _dt
        xp_earned = Decimal("0")
        is_payoff = False

        old = self.conn.execute(
            "SELECT balance, minimum FROM debts WHERE id = ?", (id,)
        ).fetchone()
        if old and old["balance"] and balance:
            old_bal = Decimal(old["balance"])
            new_bal = Decimal(balance)
            if new_bal < old_bal:
                principal_paid = old_bal - new_bal
                xp_earned += principal_paid
                if new_bal == Decimal("0"):
                    is_payoff = True
                    xp_earned += Decimal("500")  # payoff burst

        self.conn.execute(
            """INSERT INTO debts (id, name, balance, apr, minimum, months_remaining) VALUES (?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, balance=excluded.balance,
                 apr=excluded.apr, minimum=excluded.minimum,
                 months_remaining=excluded.months_remaining""",
            (id, name, balance or None, apr or None, minimum or None, months_remaining),
        )

        if xp_earned > 0:
            self.conn.execute(
                "INSERT INTO xp_events (debt_id, amount, source, created_at) VALUES (?,?,?,?)",
                (id, str(xp_earned), "payoff" if is_payoff else "payment",
                 _dt.now().isoformat()),
            )
            if is_payoff and old and old["minimum"]:
                self._credit_prize_fund(old["minimum"])

        self.conn.commit()
        return {"xp_earned": float(xp_earned), "is_payoff": is_payoff}

    def link_debt_category(self, debt_id: str, category_id: str | None) -> None:
        self.conn.execute(
            "UPDATE debts SET category_id = ? WHERE id = ?", (category_id or None, debt_id)
        )
        self.conn.commit()

    def get_savings_trackers(self) -> list[dict]:
        rows = self.conn.execute("SELECT * FROM savings_trackers ORDER BY name").fetchall()
        return [{k: r[k] for k in r.keys()} for r in rows]

    def upsert_savings_tracker(
        self, id: str, name: str, balance: str, category_id: str | None,
        goal_amount: str | None = None, monthly_contribution: str | None = None,
    ) -> None:
        self.conn.execute(
            """INSERT INTO savings_trackers (id, name, balance, category_id, goal_amount, monthly_contribution)
               VALUES (?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, balance=excluded.balance, category_id=excluded.category_id,
                 goal_amount=excluded.goal_amount, monthly_contribution=excluded.monthly_contribution""",
            (id, name, balance or "0", category_id or None,
             goal_amount or None, monthly_contribution or None),
        )
        self.conn.commit()

    def delete_savings_tracker(self, id: str) -> None:
        self.conn.execute("DELETE FROM savings_trackers WHERE id = ?", (id,))
        self.conn.commit()

    def save_debt_due_day(self, debt_id: str, due_day: int | None) -> None:
        self.conn.execute("UPDATE debts SET due_day = ? WHERE id = ?", (due_day, debt_id))
        self.conn.commit()

    def delete_debt(self, id: str) -> None:
        self.conn.execute("DELETE FROM debts WHERE id = ?", (id,))
        self.conn.commit()

    # ------------------------------------------------------------------
    # XP / Progress
    # ------------------------------------------------------------------

    def get_xp_total(self) -> Decimal:
        row = self.conn.execute("SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) FROM xp_events").fetchone()
        return Decimal(str(row[0]))

    def get_xp_events(self, limit: int = 20) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM xp_events ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [{k: r[k] for k in r.keys()} for r in rows]

    def _credit_prize_fund(self, minimum_str: str) -> None:
        from budgetapp.config.settings import SETTINGS_FILE
        import json
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        settings = json.loads(SETTINGS_FILE.read_text()) if SETTINGS_FILE.exists() else {}
        pct = Decimal(settings.get("prize_fund_pct", "10"))
        freed = Decimal(minimum_str)
        credit = (freed * pct / 100).quantize(Decimal("0.01"))
        current = Decimal(settings.get("prize_fund_balance", "0"))
        settings["prize_fund_balance"] = str(current + credit)
        SETTINGS_FILE.write_text(json.dumps(settings, indent=2))

    # ------------------------------------------------------------------
    # Assets
    # ------------------------------------------------------------------

    def get_assets(self) -> list[dict]:
        rows = self.conn.execute("SELECT * FROM assets ORDER BY name").fetchall()
        return [{k: r[k] for k in r.keys()} for r in rows]

    def upsert_asset(self, id: str, name: str, value: str, asset_type: str) -> None:
        from datetime import datetime
        self.conn.execute(
            """INSERT INTO assets (id, name, value, asset_type, updated_at) VALUES (?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, value=excluded.value,
                 asset_type=excluded.asset_type, updated_at=excluded.updated_at""",
            (id, name, value or "0", asset_type or "other", datetime.now().isoformat()),
        )
        self.conn.commit()

    def delete_asset(self, id: str) -> None:
        self.conn.execute("DELETE FROM assets WHERE id = ?", (id,))
        self.conn.commit()

    def get_net_worth(self) -> dict:
        total_assets = Decimal("0")
        for r in self.conn.execute("SELECT value FROM assets").fetchall():
            try:
                total_assets += Decimal(r["value"] or "0")
            except Exception:
                pass

        total_savings = Decimal("0")
        for r in self.conn.execute("SELECT balance FROM savings_trackers").fetchall():
            try:
                total_savings += Decimal(r["balance"] or "0")
            except Exception:
                pass

        total_debts = Decimal("0")
        for r in self.conn.execute("SELECT balance FROM debts WHERE balance IS NOT NULL").fetchall():
            try:
                total_debts += Decimal(r["balance"] or "0")
            except Exception:
                pass

        assets = self.get_assets()
        return {
            "total_assets": float(total_assets),
            "total_savings": float(total_savings),
            "total_debts": float(total_debts),
            "net_worth": float(total_assets + total_savings - total_debts),
            "assets": assets,
        }

    # ------------------------------------------------------------------
    # Splits
    # ------------------------------------------------------------------

    def get_splits(self, status: str = "pending") -> list[dict]:
        rows = self.conn.execute(
            """SELECT s.*, t.date, t.description AS tx_description, t.amount AS tx_amount
               FROM splits s
               LEFT JOIN transactions t ON s.tx_id = t.id
               WHERE s.status = ?
               ORDER BY s.created_at DESC""",
            (status,),
        ).fetchall()
        return [{k: r[k] for k in r.keys()} for r in rows]

    def create_split(self, tx_id: str, description: str, owed_by: str, amount_owed: str) -> dict:
        import uuid
        from datetime import datetime
        split_id = str(uuid.uuid4())[:16]
        now = datetime.now().isoformat()
        self.conn.execute(
            """INSERT INTO splits (id, tx_id, description, owed_by, amount_owed, status, created_at)
               VALUES (?,?,?,?,?,'pending',?)""",
            (split_id, tx_id, description, owed_by, amount_owed, now),
        )
        self.conn.commit()
        row = self.conn.execute(
            """SELECT s.*, t.date, t.description AS tx_description, t.amount AS tx_amount
               FROM splits s LEFT JOIN transactions t ON s.tx_id = t.id
               WHERE s.id = ?""",
            (split_id,),
        ).fetchone()
        return {k: row[k] for k in row.keys()}

    def settle_split(self, split_id: str) -> None:
        self.conn.execute("UPDATE splits SET status = 'settled' WHERE id = ?", (split_id,))
        self.conn.commit()

    def delete_split(self, split_id: str) -> None:
        self.conn.execute("DELETE FROM splits WHERE id = ?", (split_id,))
        self.conn.commit()

    # ------------------------------------------------------------------
    # Monthly trends
    # ------------------------------------------------------------------

    def get_monthly_trends(self, n: int = 12) -> dict:
        from datetime import date, timedelta

        today = date.today()
        first_of_current = today.replace(day=1)

        months = []
        start = first_of_current
        for _ in range(n):
            start = (start - timedelta(days=1)).replace(day=1)
            months.append(start.strftime("%Y-%m"))
        months.reverse()

        buckets = ["income", "expenses", "bills", "subscriptions", "savings", "debts"]
        series: dict[str, list[float]] = {b: [] for b in buckets}

        for month in months:
            rows = self.conn.execute(
                """SELECT c.bucket, SUM(CAST(t.amount AS REAL)) AS total
                   FROM transactions t
                   JOIN categories c ON t.category_id = c.id
                   WHERE t.date LIKE ? AND c.bucket != 'transfers'
                   GROUP BY c.bucket""",
                (f"{month}-%",),
            ).fetchall()
            by_bucket = {r["bucket"]: float(r["total"]) for r in rows}
            for b in buckets:
                val = by_bucket.get(b, 0.0)
                series[b].append(round(abs(val), 2))

        return {
            "months": months,
            "series": [{"bucket": b, "values": series[b]} for b in buckets],
        }

    # ------------------------------------------------------------------
    # Recurring detection
    # ------------------------------------------------------------------

    def detect_recurring(self) -> list[dict]:
        import re
        from datetime import date

        rows = self.conn.execute(
            """SELECT t.date, t.description, CAST(t.amount AS REAL) AS amount
               FROM transactions t
               WHERE t.category_id IS NOT NULL
               ORDER BY t.description, t.date"""
        ).fetchall()

        def normalize(desc: str) -> str:
            d = desc.lower()
            d = re.sub(r'\b\d{4,}\b', '', d)   # strip long digit runs (card numbers, ids)
            d = re.sub(r'[^a-z\s]', ' ', d)
            return re.sub(r'\s+', ' ', d).strip()

        from collections import defaultdict
        groups: dict[str, list[tuple]] = defaultdict(list)
        for r in rows:
            key = normalize(r["description"])
            if key:
                groups[key].append((r["date"], r["amount"], r["description"]))

        results = []
        for key, entries in groups.items():
            if len(entries) < 2:
                continue

            entries.sort(key=lambda x: x[0])
            dates = [e[0] for e in entries]
            amounts = [abs(e[1]) for e in entries]

            if len(dates) >= 2:
                intervals = []
                for i in range(1, len(dates)):
                    try:
                        d1 = date.fromisoformat(dates[i - 1])
                        d2 = date.fromisoformat(dates[i])
                        intervals.append((d2 - d1).days)
                    except Exception:
                        pass

                if not intervals:
                    continue

                avg_interval = sum(intervals) / len(intervals)
                is_monthly = 20 <= avg_interval <= 45
                is_weekly = 5 <= avg_interval <= 9

                if not (is_monthly or is_weekly):
                    continue

            avg_amount = sum(amounts) / len(amounts)
            is_expense = entries[-1][1] < 0

            results.append({
                "description": entries[-1][2],
                "occurrences": len(entries),
                "avg_amount": round(avg_amount, 2),
                "avg_interval": round(avg_interval, 0),
                "interval_type": "weekly" if is_weekly else "monthly",
                "last_date": dates[-1],
                "is_expense": is_expense,
            })

        results.sort(key=lambda x: x["avg_amount"], reverse=True)
        return results[:50]

    # ------------------------------------------------------------------
    # Budget guide
    # ------------------------------------------------------------------

    def get_budget_guide(self) -> dict:
        from collections import defaultdict
        from datetime import date, timedelta

        BUCKET_KEYWORDS: dict[str, list[str]] = {
            "bills": [
                "rent", "mortgage", "electric", "utility", "utilities", "insurance",
                "internet", "phone", "at&t", "verizon", "t-mobile", "comcast",
                "xfinity", "spectrum", "loan payment", "auto payment", "car payment",
                "water", "sewer", "trash", "pge", "con ed", "pseg", "national grid",
                "lease", "hoa",
            ],
            "subscriptions": [
                "netflix", "spotify", "hulu", "disney", "amazon prime", "apple.com",
                "google one", "youtube", "gym", "fitness", "membership",
                "icloud", "dropbox", "adobe", "microsoft 365", "office 365",
                "linkedin", "audible", "paramount", "peacock", "crunchyroll",
                "duolingo", "nytimes", "wsj",
            ],
            "income": [
                "payroll", "direct dep", "salary", "paycheck", "ach deposit",
                "zelle from", "venmo from",
            ],
            "savings": [
                "transfer to sav", "online transfer", "marcus", "ally",
                "wealthfront", "fidelity", "vanguard", "acorns", "sofi",
            ],
            "debts": [
                "student loan", "navient", "sallie mae", "auto loan",
                "personal loan",
            ],
        }

        def suggest_bucket(desc: str) -> str | None:
            dl = desc.lower()
            for bucket, kws in BUCKET_KEYWORDS.items():
                for kw in kws:
                    if kw in dl:
                        return bucket
            return None

        # Overall stats
        total = self.conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
        cat_count = self.conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE category_id IS NOT NULL"
        ).fetchone()[0]

        # Uncategorized — group by description
        rows = self.conn.execute(
            """SELECT id, description, CAST(amount AS REAL) AS amount, date
               FROM transactions WHERE category_id IS NULL
               ORDER BY description, date DESC"""
        ).fetchall()

        groups: dict = defaultdict(lambda: {"amounts": [], "last_date": None, "sample_id": None})
        for r in rows:
            g = groups[r["description"]]
            g["amounts"].append(abs(float(r["amount"])))
            if g["last_date"] is None:
                g["last_date"] = r["date"]
                g["sample_id"] = r["id"]

        uncategorized = []
        for desc, g in groups.items():
            uncategorized.append({
                "description": desc,
                "avg_amount": round(sum(g["amounts"]) / len(g["amounts"]), 2),
                "occurrences": len(g["amounts"]),
                "last_date": g["last_date"],
                "suggested_bucket": suggest_bucket(desc),
                "sample_tx_id": g["sample_id"],
            })

        # Sort: suggested items first (grouped by bucket), then by occurrences
        uncategorized.sort(key=lambda x: (x["suggested_bucket"] is None, -x["occurrences"]))

        # Category avg monthly spend over last 3 complete months
        today = date.today()
        y, m = today.year, today.month - 3
        if m <= 0:
            m += 12
            y -= 1
        cutoff = date(y, m, 1).isoformat()

        cat_rows = self.conn.execute(
            """SELECT c.id, c.name, c.bucket, c.budget_amount,
                      ROUND(ABS(SUM(CASE WHEN t.date >= ? THEN CAST(t.amount AS REAL) ELSE 0 END)) / 3.0, 2) AS avg_monthly
               FROM categories c
               LEFT JOIN transactions t ON t.category_id = c.id
               WHERE c.bucket != 'transfers'
               GROUP BY c.id
               ORDER BY c.bucket, c.name""",
            (cutoff,),
        ).fetchall()

        return {
            "stats": {
                "total": total,
                "categorized": cat_count,
                "uncategorized": total - cat_count,
                "pct": round(cat_count / total * 100) if total else 0,
            },
            "uncategorized": uncategorized,
            "categories": [{k: r[k] for k in r.keys()} for r in cat_rows],
        }

    # ------------------------------------------------------------------
    # Import log
    # ------------------------------------------------------------------

    def log_import(self, account_id: str, filename: str, inserted: int) -> None:
        from datetime import datetime
        self.conn.execute(
            "INSERT INTO import_log (account_id, filename, imported_at, inserted) VALUES (?,?,?,?)",
            (account_id, filename, datetime.now().isoformat(), inserted),
        )
        self.conn.commit()

    def get_import_log(self, account_id: str | None = None) -> list[dict]:
        if account_id:
            rows = self.conn.execute(
                """SELECT l.*, a.name AS account_name FROM import_log l
                   LEFT JOIN accounts a ON l.account_id = a.id
                   WHERE l.account_id = ? ORDER BY l.imported_at DESC""",
                (account_id,),
            ).fetchall()
        else:
            rows = self.conn.execute(
                """SELECT l.*, a.name AS account_name FROM import_log l
                   LEFT JOIN accounts a ON l.account_id = a.id
                   ORDER BY l.imported_at DESC LIMIT 100""",
            ).fetchall()
        return [{k: r[k] for k in r.keys()} for r in rows]

    # ------------------------------------------------------------------
    # Backup / Restore
    # ------------------------------------------------------------------

    def export_all(self) -> dict:
        def rows(sql): return [{k: r[k] for k in r.keys()} for r in self.conn.execute(sql).fetchall()]
        return {
            "version": 2,
            "accounts":            rows("SELECT * FROM accounts"),
            "categories":          rows("SELECT * FROM categories"),
            "transactions":        rows("SELECT * FROM transactions ORDER BY date"),
            "categorization_rules": rows("SELECT * FROM categorization_rules ORDER BY priority DESC"),
            "debts":               rows("SELECT * FROM debts"),
            "savings_trackers":    rows("SELECT * FROM savings_trackers"),
        }

    def import_all(self, data: dict) -> dict:
        counts: dict[str, int] = {}
        with self.conn:
            for acct in data.get("accounts", []):
                self.conn.execute(
                    """INSERT INTO accounts (id, name, bank, account_type, owner) VALUES (?,?,?,?,?)
                       ON CONFLICT(id) DO UPDATE SET name=excluded.name, bank=excluded.bank,
                         account_type=excluded.account_type, owner=excluded.owner""",
                    (acct["id"], acct["name"], acct["bank"], acct["account_type"], acct["owner"]),
                )
            counts["accounts"] = len(data.get("accounts", []))

            for cat in data.get("categories", []):
                self.conn.execute(
                    """INSERT INTO categories (id, name, bucket, owner, budget_amount) VALUES (?,?,?,?,?)
                       ON CONFLICT(id) DO UPDATE SET name=excluded.name, bucket=excluded.bucket,
                         owner=excluded.owner, budget_amount=excluded.budget_amount""",
                    (cat["id"], cat["name"], cat["bucket"], cat["owner"], cat.get("budget_amount")),
                )
            counts["categories"] = len(data.get("categories", []))

            tx_before = self.conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
            for tx in data.get("transactions", []):
                self.conn.execute(
                    """INSERT OR IGNORE INTO transactions
                       (id, date, description, raw_description, amount, account_id, category_id, user, is_manual)
                       VALUES (?,?,?,?,?,?,?,?,?)""",
                    (tx["id"], tx["date"], tx["description"], tx.get("raw_description", tx["description"]),
                     tx["amount"], tx["account_id"], tx.get("category_id"), tx.get("user", "dave"),
                     tx.get("is_manual", 0)),
                )
            tx_after = self.conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
            counts["transactions"] = tx_after - tx_before

            for rule in data.get("categorization_rules", []):
                self.conn.execute(
                    """INSERT OR IGNORE INTO categorization_rules (pattern, category_id, priority)
                       VALUES (?,?,?)""",
                    (rule["pattern"], rule["category_id"], rule.get("priority", 10)),
                )
            counts["categorization_rules"] = len(data.get("categorization_rules", []))

            for debt in data.get("debts", []):
                self.conn.execute(
                    """INSERT INTO debts (id, name, balance, apr, minimum, category_id, months_remaining)
                       VALUES (?,?,?,?,?,?,?)
                       ON CONFLICT(id) DO UPDATE SET name=excluded.name, balance=excluded.balance,
                         apr=excluded.apr, minimum=excluded.minimum, category_id=excluded.category_id,
                         months_remaining=excluded.months_remaining""",
                    (debt["id"], debt["name"], debt.get("balance"), debt.get("apr"),
                     debt.get("minimum"), debt.get("category_id"), debt.get("months_remaining")),
                )
            counts["debts"] = len(data.get("debts", []))

            for sav in data.get("savings_trackers", []):
                self.conn.execute(
                    """INSERT INTO savings_trackers
                       (id, name, balance, category_id, goal_amount, monthly_contribution) VALUES (?,?,?,?,?,?)
                       ON CONFLICT(id) DO UPDATE SET name=excluded.name, balance=excluded.balance,
                         category_id=excluded.category_id, goal_amount=excluded.goal_amount,
                         monthly_contribution=excluded.monthly_contribution""",
                    (sav["id"], sav["name"], sav.get("balance", "0"), sav.get("category_id"),
                     sav.get("goal_amount"), sav.get("monthly_contribution")),
                )
            counts["savings_trackers"] = len(data.get("savings_trackers", []))

        return counts

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
