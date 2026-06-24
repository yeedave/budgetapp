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


def _desc_similar(a: str, b: str) -> bool:
    """Fuzzy description match — same after case-fold, or one is a prefix of the other
    (min 5 chars). Catches "H Mart" vs "h mart" and "H Mart" vs "H Mart Chicago IL"."""
    a, b = (a or "").lower().strip(), (b or "").lower().strip()
    if a == b:
        return True
    short, long = (a, b) if len(a) <= len(b) else (b, a)
    return len(short) >= 5 and long.startswith(short)


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

    def find_existing_near_match(self, account_id: str, date_str: str,
                                  amount_str: str, description: str,
                                  date_window_days: int = 3) -> dict | None:
        """Return a near-duplicate existing transaction if one is found, else None.

        Match policy: same account, same amount, date within ±N days, and a fuzzy
        description match (case-insensitive equality or prefix). The ±N-day window
        catches the pending-vs-posted case where you pasted a pending transaction
        with today's date and the statement later posts it 1-2 days later. The
        amount-equality requirement prevents false collapses across different
        transactions for the same merchant."""
        from datetime import date, timedelta
        try:
            target = date.fromisoformat(date_str)
        except Exception:
            target = None
        if target is None or date_window_days <= 0:
            # Exact-date match only
            rows = self.conn.execute(
                """SELECT id, description, amount, date FROM transactions
                   WHERE account_id = ? AND date = ? AND amount = ?""",
                (account_id, date_str, amount_str),
            ).fetchall()
        else:
            lo = (target - timedelta(days=date_window_days)).isoformat()
            hi = (target + timedelta(days=date_window_days)).isoformat()
            rows = self.conn.execute(
                """SELECT id, description, amount, date FROM transactions
                   WHERE account_id = ? AND amount = ? AND date BETWEEN ? AND ?""",
                (account_id, amount_str, lo, hi),
            ).fetchall()
        for r in rows:
            if _desc_similar(r["description"], description):
                return {"id": r["id"], "description": r["description"], "date": r["date"]}
        return None

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

    def flip_transaction_sign(self, tx_id: str) -> None:
        """Flip an income transaction to an expense (or vice versa) by negating
        its amount. If the transaction is linked to a debt or savings tracker via
        its category, the balance is adjusted to stay consistent."""
        row = self.conn.execute(
            "SELECT amount, category_id, account_id FROM transactions WHERE id = ?", (tx_id,)
        ).fetchone()
        if not row:
            return
        old_amount = Decimal(row["amount"])
        new_amount = -old_amount
        self.conn.execute(
            "UPDATE transactions SET amount = ? WHERE id = ?",
            (str(new_amount), tx_id),
        )
        if row["category_id"]:
            acc = self.conn.execute(
                "SELECT account_type FROM accounts WHERE id = ?", (row["account_id"],)
            ).fetchone()
            from_sav = bool(acc and acc["account_type"] == "savings")
            # delta = new - old = -2*old; this both reverses the original adjustment
            # and applies the new one in a single call
            self._adjust_linked_balance(row["category_id"], new_amount - old_amount, from_sav)
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

        # Envelope spending: if this category is in the spend list of any tracker,
        # add the transaction amount directly to the tracker balance. For an
        # expense (amount < 0) this decreases the envelope; a refund (amount > 0)
        # increases it.
        spend_links = self.conn.execute(
            """SELECT t.id, t.balance
               FROM savings_trackers t
               JOIN savings_tracker_spend_categories l ON l.tracker_id = t.id
               WHERE l.category_id = ?""",
            (category_id,),
        ).fetchall()
        for s in spend_links:
            new_bal = Decimal(s["balance"] or "0") + amount
            self.conn.execute("UPDATE savings_trackers SET balance = ? WHERE id = ?",
                              (str(new_bal), s["id"]))

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
        # Block deletion only if real transactions still reference the category —
        # that's the case where data loss would be visible to the user.
        in_use = self.conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE category_id = ?", (cat_id,)
        ).fetchone()[0]
        if in_use:
            raise ValueError(f"Cannot delete: {in_use} transaction(s) still use this category.")

        # Clean up secondary references that would otherwise trip FK constraints.
        # Rules and budget-bucket links are safe to drop — they're configuration,
        # not user data. Debt / savings tracker / manual_recurring links can be
        # nulled out without losing the underlying entity.
        self.conn.execute("DELETE FROM categorization_rules WHERE category_id = ?", (cat_id,))
        self.conn.execute("DELETE FROM budget_bucket_categories WHERE category_id = ?", (cat_id,))
        self.conn.execute("DELETE FROM savings_tracker_spend_categories WHERE category_id = ?", (cat_id,))
        self.conn.execute("UPDATE debts SET category_id = NULL WHERE category_id = ?", (cat_id,))
        self.conn.execute("UPDATE savings_trackers SET category_id = NULL WHERE category_id = ?", (cat_id,))
        # manual_recurring may not exist on older installs — guard with try/except.
        try:
            self.conn.execute("UPDATE manual_recurring SET category_id = NULL WHERE category_id = ?", (cat_id,))
        except Exception:
            pass

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

    def update_rule(self, rule_id: int, pattern: str, category_id: str) -> dict:
        self.conn.execute(
            "UPDATE categorization_rules SET pattern = ?, category_id = ? WHERE id = ?",
            (pattern, category_id, rule_id),
        )
        self.conn.commit()
        return {"id": rule_id, "pattern": pattern, "category_id": category_id}

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
        cur = self.conn.execute(
            """INSERT OR IGNORE INTO transactions
               (id, date, description, raw_description, amount, account_id, category_id, user, is_manual)
               VALUES (?,?,?,?,?,?,?,?,1)""",
            (tx_id, date_str, description, description, amount_str, account_id, category_id or None, "dave"),
        )
        # Fire balance adjustments if this was a fresh insert with a category
        # (debt link, savings contribution, or envelope spend category).
        if cur.rowcount > 0 and category_id:
            acc = self.conn.execute(
                "SELECT account_type FROM accounts WHERE id = ?", (account_id,)
            ).fetchone()
            from_sav = bool(acc and acc["account_type"] == "savings")
            self._adjust_linked_balance(category_id, Decimal(amount_str), from_sav)
        self.conn.commit()
        row = self.conn.execute("SELECT * FROM transactions WHERE id = ?", (tx_id,)).fetchone()
        return self._row_to_transaction(row)

    def delete_transaction(self, tx_id: str) -> None:
        # Reverse any linked-balance adjustment before deleting so debts and
        # envelope trackers stay in sync.
        row = self.conn.execute(
            """SELECT t.amount, t.category_id, a.account_type
               FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id
               WHERE t.id = ?""",
            (tx_id,),
        ).fetchone()
        if row and row["category_id"]:
            from_sav = bool(row["account_type"] == "savings")
            self._adjust_linked_balance(row["category_id"], -Decimal(row["amount"]), from_sav)
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
        result = []
        for r in rows:
            entry = {k: r[k] for k in r.keys()}
            spends = self.conn.execute(
                "SELECT category_id FROM savings_tracker_spend_categories WHERE tracker_id = ?",
                (entry["id"],),
            ).fetchall()
            entry["spend_categories"] = [s["category_id"] for s in spends]
            result.append(entry)
        return result

    def set_tracker_spend_categories(self, tracker_id: str, category_ids: list[str]) -> None:
        self.conn.execute(
            "DELETE FROM savings_tracker_spend_categories WHERE tracker_id = ?",
            (tracker_id,),
        )
        for cid in category_ids:
            if cid:
                self.conn.execute(
                    "INSERT OR IGNORE INTO savings_tracker_spend_categories (tracker_id, category_id) VALUES (?, ?)",
                    (tracker_id, cid),
                )
        self.conn.commit()

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
        self.conn.execute("DELETE FROM savings_tracker_spend_categories WHERE tracker_id = ?", (id,))
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

    _SPLIT_CATEGORY_ID = "transfer_split_owed"

    def _ensure_split_category(self) -> str:
        """Ensure the special "Split — Owed by Others" category exists in the
        Transfers bucket. Returns its id. Putting it in Transfers means the owed
        portion is excluded from your income/expense totals automatically."""
        existing = self.conn.execute(
            "SELECT id FROM categories WHERE id = ?", (self._SPLIT_CATEGORY_ID,)
        ).fetchone()
        if existing:
            return self._SPLIT_CATEGORY_ID
        self.conn.execute(
            "INSERT INTO categories (id, name, bucket, owner, budget_amount) VALUES (?,?,?,?,?)",
            (self._SPLIT_CATEGORY_ID, "Split — Owed by Others", "transfers", "shared", None),
        )
        self.conn.commit()
        return self._SPLIT_CATEGORY_ID

    def create_split(self, tx_id: str, description: str, owed_by: str, amount_owed: str) -> dict:
        """Splits the original transaction into two:
          1. Original keeps the portion you actually owe (amount reduced by amount_owed)
          2. A new transaction representing the portion someone else owes you,
             tagged with the Transfers/Split category so it doesn't count as
             your own spending.
        """
        import uuid
        from datetime import datetime
        from decimal import Decimal

        orig = self.conn.execute(
            "SELECT * FROM transactions WHERE id = ?", (tx_id,)
        ).fetchone()
        if not orig:
            raise ValueError("Original transaction not found")

        orig_amount = Decimal(orig["amount"])
        owed = Decimal(amount_owed)
        if owed <= 0:
            raise ValueError("Amount owed must be greater than zero")
        if abs(owed) >= abs(orig_amount):
            raise ValueError(f"Amount owed ({owed}) must be less than the transaction amount ({abs(orig_amount)})")

        # Reduce original by the owed portion. Original keeps its sign (expense stays negative).
        sign = Decimal(-1) if orig_amount < 0 else Decimal(1)
        owed_signed = sign * owed
        new_orig_amount = orig_amount - owed_signed   # e.g. -100 - (-40) = -60

        split_cat = self._ensure_split_category()
        split_desc = f"Owed by {owed_by} — {orig['description']}"

        # Generate a deterministic tx id that won't clash with the original
        new_tx_id = _tx_id(orig["date"], split_desc, str(owed_signed), orig["account_id"], 0)

        # Update original and insert the new "owed" tx in one go
        self.conn.execute(
            "UPDATE transactions SET amount = ? WHERE id = ?",
            (str(new_orig_amount), tx_id),
        )
        self.conn.execute(
            """INSERT OR IGNORE INTO transactions
               (id, date, description, raw_description, amount, account_id, category_id, user, is_manual)
               VALUES (?,?,?,?,?,?,?,?,1)""",
            (new_tx_id, orig["date"], split_desc, split_desc, str(owed_signed),
             orig["account_id"], split_cat, orig["user"]),
        )

        split_id = str(uuid.uuid4())[:16]
        now = datetime.now().isoformat()
        self.conn.execute(
            """INSERT INTO splits (id, tx_id, description, owed_by, amount_owed,
                                    status, created_at, split_tx_id)
               VALUES (?,?,?,?,?,'pending',?,?)""",
            (split_id, tx_id, description, owed_by, amount_owed, now, new_tx_id),
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
        """Reverse the split: restore the original transaction's amount, delete the
        "owed by" transaction we created, then delete the split record."""
        from decimal import Decimal
        row = self.conn.execute(
            "SELECT tx_id, split_tx_id, amount_owed FROM splits WHERE id = ?", (split_id,)
        ).fetchone()
        if row and row["split_tx_id"]:
            owed_tx = self.conn.execute(
                "SELECT amount FROM transactions WHERE id = ?", (row["split_tx_id"],)
            ).fetchone()
            orig_tx = self.conn.execute(
                "SELECT amount FROM transactions WHERE id = ?", (row["tx_id"],)
            ).fetchone()
            if owed_tx and orig_tx:
                # Restore original by adding the owed portion back (with its sign).
                restored = Decimal(orig_tx["amount"]) + Decimal(owed_tx["amount"])
                self.conn.execute(
                    "UPDATE transactions SET amount = ? WHERE id = ?",
                    (str(restored), row["tx_id"]),
                )
            self.conn.execute("DELETE FROM transactions WHERE id = ?", (row["split_tx_id"],))
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

    @staticmethod
    def _normalize_desc(desc: str) -> str:
        import re
        d = desc.lower()
        d = re.sub(r'\b\d{4,}\b', '', d)
        d = re.sub(r'[^a-z\s]', ' ', d)
        return re.sub(r'\s+', ' ', d).strip()

    def get_recurring_excluded(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT normalized_description, sample_description, excluded_at "
            "FROM recurring_excluded ORDER BY excluded_at DESC"
        ).fetchall()
        return [{k: r[k] for k in r.keys()} for r in rows]

    def exclude_recurring(self, description: str) -> dict:
        from datetime import datetime
        norm = self._normalize_desc(description)
        if not norm:
            return {"ok": False, "error": "empty description"}
        self.conn.execute(
            "INSERT OR REPLACE INTO recurring_excluded "
            "(normalized_description, sample_description, excluded_at) VALUES (?, ?, ?)",
            (norm, description, datetime.now().isoformat()),
        )
        self.conn.commit()
        return {"ok": True, "normalized_description": norm}

    def unexclude_recurring(self, normalized_description: str) -> None:
        self.conn.execute(
            "DELETE FROM recurring_excluded WHERE normalized_description = ?",
            (normalized_description,),
        )
        self.conn.commit()

    # ------------------------------------------------------------------
    # Manual recurring payments (user-added)
    # ------------------------------------------------------------------

    def get_manual_recurring(self) -> list[dict]:
        rows = self.conn.execute(
            """SELECT mr.id, mr.label, mr.amount, mr.day_of_month, mr.interval_months,
                      mr.start_date, mr.category_id, mr.created_at,
                      mr.frequency, mr.second_day_of_month,
                      c.name AS category_name
               FROM manual_recurring mr
               LEFT JOIN categories c ON mr.category_id = c.id
               ORDER BY mr.day_of_month, mr.label"""
        ).fetchall()
        return [{k: r[k] for k in r.keys()} for r in rows]

    def add_manual_recurring(
        self, label: str, amount: str | None, day_of_month: int,
        interval_months: int, start_date: str, category_id: str | None,
        frequency: str = 'monthly', second_day_of_month: int | None = None,
    ) -> dict:
        import uuid
        from datetime import datetime
        rid = uuid.uuid4().hex[:12]
        self.conn.execute(
            """INSERT INTO manual_recurring
               (id, label, amount, day_of_month, interval_months, start_date,
                category_id, created_at, frequency, second_day_of_month)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (rid, label, amount, day_of_month, interval_months, start_date,
             category_id, datetime.now().isoformat(),
             frequency or 'monthly', second_day_of_month),
        )
        self.conn.commit()
        return {"id": rid}

    def delete_manual_recurring(self, recurring_id: str) -> None:
        self.conn.execute("DELETE FROM manual_recurring WHERE id = ?", (recurring_id,))
        self.conn.commit()

    @staticmethod
    def _project_manual_occurrences(rec: dict, range_start, range_end) -> list:
        """Yield each occurrence of a manual_recurring entry inside [range_start, range_end].

        Handles three frequencies:
          - 'biweekly':   every 14 days starting from start_date
          - 'semimonthly': two days per month (day_of_month + second_day_of_month)
          - 'monthly' (default): day_of_month every interval_months
        """
        from datetime import date, timedelta
        import calendar as cal_mod
        try:
            start = date.fromisoformat(rec["start_date"])
        except Exception:
            return []
        frequency = (rec.get("frequency") or "monthly").lower()

        # ── Bi-weekly: every 14 days from start_date ─────────────────────
        if frequency == "biweekly":
            occ = start
            # Fast-forward to first occurrence at/after range_start
            if occ < range_start:
                delta_days = (range_start - occ).days
                steps = delta_days // 14
                occ = occ + timedelta(days=steps * 14)
                if occ < range_start:
                    occ += timedelta(days=14)
            out = []
            while occ <= range_end:
                if occ >= start:
                    out.append(occ)
                occ += timedelta(days=14)
            return out

        # ── Semi-monthly: two days per month ─────────────────────────────
        if frequency == "semimonthly":
            day_a = int(rec["day_of_month"])
            day_b = int(rec.get("second_day_of_month") or (day_a + 15))
            days = sorted({day_a, day_b})
            out = []
            y, m = range_start.year, range_start.month
            while True:
                last_in_month = cal_mod.monthrange(y, m)[1]
                for d in days:
                    actual = min(d, last_in_month)
                    try:
                        occ = date(y, m, actual)
                    except ValueError:
                        continue
                    if occ > range_end:
                        return sorted(set(out))
                    if occ >= range_start and occ >= start:
                        out.append(occ)
                # Step to next month
                m += 1
                if m > 12:
                    m = 1
                    y += 1
                if date(y, m, 1) > range_end:
                    return sorted(set(out))

        # ── Monthly (default): day_of_month every interval_months ────────
        day = int(rec["day_of_month"])
        interval = max(1, int(rec.get("interval_months") or 1))
        y, m = max(start.year, range_start.year), 0
        if start.year > range_start.year or (start.year == range_start.year and start.month > range_start.month):
            y, m = start.year, start.month
        else:
            y, m = range_start.year, range_start.month
        months_since_start = (y - start.year) * 12 + (m - start.month)
        if months_since_start % interval != 0:
            months_since_start += interval - (months_since_start % interval)
            y = start.year + (start.month - 1 + months_since_start) // 12
            m = (start.month - 1 + months_since_start) % 12 + 1

        occurrences = []
        while True:
            last_day = cal_mod.monthrange(y, m)[1]
            actual_day = min(day, last_day)
            try:
                occ = date(y, m, actual_day)
            except ValueError:
                occ = None
            if occ:
                if occ > range_end:
                    break
                if occ >= range_start and occ >= start:
                    occurrences.append(occ)
            new_idx = (m - 1) + interval
            y += new_idx // 12
            m = (new_idx % 12) + 1
        return occurrences

    def get_upcoming_scheduled(self, days_ahead: int = 60) -> list[dict]:
        """All scheduled items from today through N days ahead — debts, auto-detected
        recurring projections, and manual recurring entries — merged and sorted."""
        from datetime import date, timedelta
        today = date.today()
        end = today + timedelta(days=max(1, days_ahead))

        results: list[dict] = []

        # Debt due dates
        for d in self.get_debts():
            due_day = d.get("due_day")
            if not due_day:
                continue
            for n in range(0, days_ahead // 28 + 2):
                month_anchor = (today.replace(day=1) + timedelta(days=32 * n)).replace(day=1)
                import calendar as cal_mod
                last_day = cal_mod.monthrange(month_anchor.year, month_anchor.month)[1]
                day = min(int(due_day), last_day)
                occ = date(month_anchor.year, month_anchor.month, day)
                if today <= occ <= end:
                    results.append({
                        "date": occ.isoformat(),
                        "label": d["name"],
                        "amount": d.get("minimum"),
                        "source": "debt",
                        "id": d["id"],
                    })

        # Auto-detected recurring — separate income from expenses so the UI
        # can color paydays green and exclude them from cash-needed totals.
        for r in self.detect_recurring():
            try:
                last = date.fromisoformat(r["last_date"])
            except Exception:
                continue
            interval_days = max(1, int(r.get("avg_interval", 30)))
            proj = last + timedelta(days=interval_days)
            source = "recurring" if r.get("is_expense", True) else "income"
            while proj <= end:
                if proj >= today:
                    results.append({
                        "date": proj.isoformat(),
                        "label": r["description"],
                        "amount": str(r["avg_amount"]),
                        "source": source,
                        "id": None,
                    })
                proj += timedelta(days=interval_days)

        # Manual recurring — amount sign determines income vs expense
        for rec in self.get_manual_recurring():
            try:
                amt_val = float(rec.get("amount") or 0)
            except (ValueError, TypeError):
                amt_val = 0
            src = "income" if amt_val > 0 else "manual"
            for occ in self._project_manual_occurrences(rec, today, end):
                results.append({
                    "date": occ.isoformat(),
                    "label": rec["label"],
                    "amount": rec.get("amount"),
                    "source": src,
                    "id": rec["id"],
                })

        results.sort(key=lambda r: r["date"])
        return results

    def detect_recurring(self) -> list[dict]:
        from datetime import date

        rows = self.conn.execute(
            """SELECT t.date, t.description, CAST(t.amount AS REAL) AS amount
               FROM transactions t
               WHERE t.category_id IS NOT NULL
               ORDER BY t.description, t.date"""
        ).fetchall()

        excluded = {r["normalized_description"] for r in
                    self.conn.execute("SELECT normalized_description FROM recurring_excluded").fetchall()}

        normalize = self._normalize_desc

        from collections import defaultdict
        groups: dict[str, list[tuple]] = defaultdict(list)
        seen_date_keys: set[tuple] = set()
        for r in rows:
            key = normalize(r["description"])
            if not key or key in excluded:
                continue
            # Dedupe same-date repeats per merchant — common for split payroll deposits
            # (main + stipend on the same day) which would otherwise yield zero-day
            # intervals and mislabel a bi-weekly cadence as weekly.
            dedup_key = (key, r["date"])
            if dedup_key in seen_date_keys:
                continue
            seen_date_keys.add(dedup_key)
            groups[key].append((r["date"], r["amount"], r["description"]))

        # Keywords that indicate a utility/bill — we accept variable amounts
        # for these because utility statements legitimately vary month-to-month.
        # For everything else (groceries, dining, shopping) variable amounts
        # are not "recurring" — they're just frequent.
        UTILITY_KEYWORDS = (
            'edison', 'pge', 'pg&e', 'utility', 'utilities', 'water', 'sewer',
            'gas company', 'electric', 'spectrum', 'comcast', 'xfinity', 'cox',
            'verizon', 'at&t', 'tmobile', 't-mobile', 'sprint', 'centurylink',
            'internet', 'phone bill', 'trash', 'waste', 'cable', 'so cal',
            # Rent / housing — often varies slightly month-to-month
            'rent', 'mortgage', 'apartment', 'landlord', 'lease', 'hoa',
            'domuso', 'avalon', 'equity res', 'greystar', 'realpage',
        )

        results = []
        for key, entries in groups.items():
            # Require at least 3 occurrences — 2 can happen by coincidence.
            if len(entries) < 3:
                continue

            entries.sort(key=lambda x: x[0])
            dates = [e[0] for e in entries]
            amounts = [abs(e[1]) for e in entries]
            descriptions_blob = " ".join(e[2] for e in entries).lower()

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

            # Median interval is robust to one missed/extra payment.
            sorted_intervals = sorted(intervals)
            median_interval = sorted_intervals[len(sorted_intervals) // 2]
            if 5 <= median_interval <= 9:
                interval_type = "weekly"
            elif 12 <= median_interval <= 17:
                interval_type = "biweekly"
            elif 25 <= median_interval <= 35:
                interval_type = "monthly"
            else:
                continue

            # Amount-consistency check: a real recurring charge has a stable
            # amount month after month. Variable amounts only count if the
            # description looks like a utility/bill.
            avg_amount = sum(amounts) / len(amounts)
            max_amt, min_amt = max(amounts), min(amounts)
            spread = max_amt - min_amt
            relative_spread = spread / avg_amount if avg_amount > 0 else 0

            is_consistent = relative_spread <= 0.10  # within 10% — catches modest fluctuations
            is_utility = any(kw in descriptions_blob for kw in UTILITY_KEYWORDS)

            if not (is_consistent or is_utility):
                continue   # variable-amount + non-utility → not a real recurring bill

            is_expense = entries[-1][1] < 0

            results.append({
                "description": entries[-1][2],
                "occurrences": len(entries),
                "avg_amount": round(avg_amount, 2),
                "avg_interval": round(median_interval, 0),
                "interval_type": interval_type,
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
