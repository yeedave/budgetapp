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
        # When True, mutation methods skip writing to activity_log — used during
        # undo_activity() so an undo doesn't create a fresh log entry that would
        # itself be undoable.
        self._suppress_log = False
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

    def upsert_transactions(self, df: pd.DataFrame, user: str = "dave") -> list[str]:
        """Insert parsed DataFrame rows; skip duplicates.
        Returns a list of transaction IDs that were newly inserted (len() = count)."""
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

        # Snapshot pre-existing IDs so we can identify which rows are new
        candidate_ids = [r[0] for r in rows]
        placeholders = ','.join('?' * len(candidate_ids)) if candidate_ids else ''
        existing_before = set()
        if candidate_ids:
            existing_before = {
                r[0] for r in self.conn.execute(
                    f"SELECT id FROM transactions WHERE id IN ({placeholders})",
                    candidate_ids,
                ).fetchall()
            }
        self.conn.executemany(
            """INSERT OR IGNORE INTO transactions
               (id, date, description, raw_description, amount, account_id, category_id, user)
               VALUES (?,?,?,?,?,?,?,?)""",
            rows,
        )
        newly_inserted = [tid for tid in candidate_ids if tid not in existing_before]

        # Fire balance adjustments for newly inserted rows (savings split + debt tracking on import)
        acct_type_cache: dict[str, str] = {}
        for _, amount_str, account_id, cat in new_with_cat:
            if account_id not in acct_type_cache:
                r = self.conn.execute("SELECT account_type FROM accounts WHERE id = ?", (account_id,)).fetchone()
                acct_type_cache[account_id] = r["account_type"] if r else ""
            from_sav = acct_type_cache[account_id] == "savings"
            self._adjust_linked_balance(cat, Decimal(amount_str), from_sav)

        self.conn.commit()
        return newly_inserted

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
            "SELECT amount, category_id, account_id, description FROM transactions WHERE id = ?", (tx_id,)
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
        if not self._suppress_log:
            direction = f"{old_amount} → {new_amount}"
            self._log_activity(
                "flip_sign",
                f"Flipped sign on {row['description'][:60]}: {direction}",
                {"tx_id": tx_id},
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
        # Track category history for undo — record every affected tx's old cat
        changes: list[dict] = [{"tx_id": tx_id, "old_category": row["category_id"] if row else None}]
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
                        changes.append({"tx_id": m["id"], "old_category": None})
                        self.conn.execute(
                            "UPDATE transactions SET category_id = ? WHERE id = ?",
                            (category_id, m["id"]),
                        )
                        self._adjust_linked_balance(
                            category_id, Decimal(m["amount"]),
                            (m["account_type"] or "") == "savings",
                        )
                        updated_ids.append(m["id"])
        if not self._suppress_log:
            desc = (row["description"] if row else "") or tx_id
            summary = (f"Categorized {len(changes)} tx" if len(changes) > 1
                       else f"Categorized: {desc[:60]}")
            self._log_activity(
                "set_category",
                summary,
                {"changes": changes, "new_category": category_id or None},
            )
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
        newly_added = cur.rowcount > 0
        # Fire balance adjustments if this was a fresh insert with a category
        # (debt link, savings contribution, or envelope spend category).
        if newly_added and category_id:
            acc = self.conn.execute(
                "SELECT account_type FROM accounts WHERE id = ?", (account_id,)
            ).fetchone()
            from_sav = bool(acc and acc["account_type"] == "savings")
            self._adjust_linked_balance(category_id, Decimal(amount_str), from_sav)
        if newly_added and not self._suppress_log:
            self._log_activity(
                "add_tx",
                f"Added manual transaction: {description[:60]} ({amount_str})",
                {"tx_id": tx_id},
            )
        self.conn.commit()
        row = self.conn.execute("SELECT * FROM transactions WHERE id = ?", (tx_id,)).fetchone()
        return self._row_to_transaction(row)

    def delete_transaction(self, tx_id: str) -> None:
        # Snapshot the full row for the activity log so undo can restore it.
        full_row = self.conn.execute(
            "SELECT * FROM transactions WHERE id = ?", (tx_id,)
        ).fetchone()
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
        if full_row and not self._suppress_log:
            row_dict = {k: full_row[k] for k in full_row.keys()}
            self._log_activity(
                "delete_tx",
                f"Deleted transaction: {row_dict['description'][:60]} ({row_dict['amount']})",
                {"row": row_dict},
            )
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
        # Snapshot rows before delete for undo. Reverse balance adjustments too.
        if account_id:
            rows = self.conn.execute(
                "SELECT * FROM transactions WHERE date >= ? AND date <= ? AND account_id = ?",
                (start_date, end_date, account_id),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM transactions WHERE date >= ? AND date <= ?",
                (start_date, end_date),
            ).fetchall()
        snapshot = [{k: r[k] for k in r.keys()} for r in rows]
        for r in snapshot:
            if r["category_id"]:
                acc = self.conn.execute(
                    "SELECT account_type FROM accounts WHERE id = ?", (r["account_id"],)
                ).fetchone()
                from_sav = bool(acc and acc["account_type"] == "savings")
                self._adjust_linked_balance(r["category_id"], -Decimal(r["amount"]), from_sav)
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
        if snapshot and not self._suppress_log:
            scope = f" on {account_id}" if account_id else ""
            self._log_activity(
                "bulk_delete",
                f"Bulk delete: {len(snapshot)} txn{'s' if len(snapshot) != 1 else ''} "
                f"between {start_date} and {end_date}{scope}",
                {"rows": snapshot, "start": start_date, "end": end_date, "account_id": account_id},
            )
        self.conn.commit()
        return len(snapshot)

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
        if not self._suppress_log:
            self._log_activity(
                "split_create",
                f"Split: {owed_by} owes {amount_owed} on {orig['description'][:60]}",
                {"split_id": split_id},
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
    # Paid-ahead scheduled occurrences
    # ------------------------------------------------------------------

    def mark_recurring_paid(self, label: str, scheduled_date: str) -> dict:
        """Mark a single upcoming/overdue projection as already paid so it
        drops off the calendar and Upcoming Payments list."""
        from datetime import datetime
        norm = self._normalize_desc(label)
        if not norm or not scheduled_date:
            return {"ok": False, "error": "label + date required"}
        self.conn.execute(
            "INSERT OR REPLACE INTO recurring_paid_occurrences "
            "(normalized_label, scheduled_date, sample_label, marked_at) VALUES (?, ?, ?, ?)",
            (norm, scheduled_date, label, datetime.now().isoformat()),
        )
        self.conn.commit()
        return {"ok": True}

    def unmark_recurring_paid(self, label: str, scheduled_date: str) -> None:
        norm = self._normalize_desc(label)
        self.conn.execute(
            "DELETE FROM recurring_paid_occurrences "
            "WHERE normalized_label = ? AND scheduled_date = ?",
            (norm, scheduled_date),
        )
        self.conn.commit()

    def get_recurring_paid(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT normalized_label, scheduled_date, sample_label, marked_at "
            "FROM recurring_paid_occurrences ORDER BY scheduled_date DESC"
        ).fetchall()
        return [{k: r[k] for k in r.keys()} for r in rows]

    # ------------------------------------------------------------------
    # AI Advisor chat persistence
    # ------------------------------------------------------------------

    def get_or_create_active_conversation(self) -> str:
        """Return the id of the most-recent non-archived conversation, creating
        one if none exists. Called at chat load and before saving messages so
        the caller never has to think about the conversation lifecycle."""
        row = self.conn.execute(
            "SELECT id FROM advisor_conversations WHERE archived = 0 "
            "ORDER BY updated_at DESC LIMIT 1"
        ).fetchone()
        if row:
            return row["id"]
        return self.create_advisor_conversation()

    def create_advisor_conversation(self, title: str | None = None) -> str:
        import uuid
        from datetime import datetime
        cid = uuid.uuid4().hex[:12]
        now = datetime.now().isoformat()
        self.conn.execute(
            "INSERT INTO advisor_conversations (id, title, created_at, updated_at, archived) "
            "VALUES (?, ?, ?, ?, 0)",
            (cid, title, now, now),
        )
        self.conn.commit()
        return cid

    def list_advisor_conversations(self, include_archived: bool = False) -> list[dict]:
        sql = ("SELECT c.id, c.title, c.created_at, c.updated_at, c.archived, "
               "  (SELECT COUNT(*) FROM advisor_messages m WHERE m.conversation_id = c.id) AS message_count, "
               "  (SELECT m.content FROM advisor_messages m WHERE m.conversation_id = c.id AND m.role = 'user' "
               "     ORDER BY m.id ASC LIMIT 1) AS first_user_message "
               "FROM advisor_conversations c ")
        if not include_archived:
            sql += "WHERE c.archived = 0 "
        sql += "ORDER BY c.updated_at DESC"
        rows = self.conn.execute(sql).fetchall()
        return [{k: r[k] for k in r.keys()} for r in rows]

    def get_advisor_messages(self, conversation_id: str) -> list[dict]:
        rows = self.conn.execute(
            "SELECT id, role, content, input_tokens, output_tokens, created_at "
            "FROM advisor_messages WHERE conversation_id = ? ORDER BY id ASC",
            (conversation_id,),
        ).fetchall()
        return [{k: r[k] for k in r.keys()} for r in rows]

    def add_advisor_message(
        self, conversation_id: str, role: str, content: str,
        input_tokens: int | None = None, output_tokens: int | None = None,
    ) -> int:
        from datetime import datetime
        now = datetime.now().isoformat()
        cur = self.conn.execute(
            "INSERT INTO advisor_messages "
            "(conversation_id, role, content, input_tokens, output_tokens, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (conversation_id, role, content, input_tokens, output_tokens, now),
        )
        # Bump conversation updated_at + backfill title from the first user message
        self.conn.execute(
            "UPDATE advisor_conversations SET updated_at = ?, "
            "title = COALESCE(title, CASE WHEN ? = 'user' THEN substr(?, 1, 60) ELSE title END) "
            "WHERE id = ?",
            (now, role, content, conversation_id),
        )
        self.conn.commit()
        return cur.lastrowid or 0

    def archive_advisor_conversation(self, conversation_id: str) -> None:
        """Archive (soft-delete) a conversation — hides from the active picker
        but preserves the messages so they can be re-opened later."""
        self.conn.execute(
            "UPDATE advisor_conversations SET archived = 1 WHERE id = ?",
            (conversation_id,),
        )
        self.conn.commit()

    def delete_advisor_conversation(self, conversation_id: str) -> None:
        """Hard delete — messages are removed by ON DELETE CASCADE."""
        self.conn.execute(
            "DELETE FROM advisor_conversations WHERE id = ?",
            (conversation_id,),
        )
        self.conn.commit()

    def _paid_ahead_set(self) -> set[tuple[str, str]]:
        """Return the (normalized_label, scheduled_date) pairs already marked paid."""
        rows = self.conn.execute(
            "SELECT normalized_label, scheduled_date FROM recurring_paid_occurrences"
        ).fetchall()
        return {(r["normalized_label"], r["scheduled_date"]) for r in rows}

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

    def update_manual_recurring(
        self, recurring_id: str, label: str, amount: str | None, day_of_month: int,
        interval_months: int, start_date: str, category_id: str | None,
        frequency: str = "monthly", second_day_of_month: int | None = None,
    ) -> dict:
        cur = self.conn.execute(
            """UPDATE manual_recurring SET
                 label = ?, amount = ?, day_of_month = ?, interval_months = ?,
                 start_date = ?, category_id = ?, frequency = ?, second_day_of_month = ?
               WHERE id = ?""",
            (label, amount, day_of_month, interval_months, start_date,
             category_id, frequency or "monthly", second_day_of_month, recurring_id),
        )
        self.conn.commit()
        if cur.rowcount == 0:
            raise ValueError("Recurring entry not found")
        return {"id": recurring_id}

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
        recurring projections, and manual recurring entries — merged and sorted.
        Items the user has marked paid-ahead (via mark_recurring_paid) are omitted."""
        from datetime import date, timedelta
        today = date.today()
        end = today + timedelta(days=max(1, days_ahead))

        paid_ahead = self._paid_ahead_set()
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
                    if (self._normalize_desc(d["name"]), occ.isoformat()) in paid_ahead:
                        continue
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
            norm_label = self._normalize_desc(r["description"])
            while proj <= end:
                if proj >= today and (norm_label, proj.isoformat()) not in paid_ahead:
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
            norm_label = self._normalize_desc(rec["label"])
            for occ in self._project_manual_occurrences(rec, today, end):
                if (norm_label, occ.isoformat()) in paid_ahead:
                    continue
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

    def recurring_candidates(self, min_occurrences: int = 2, limit: int = 300) -> list[dict]:
        """Loose picker feed: every description that shows up more than once,
        regardless of category, interval, or amount consistency.

        Used by the "Pick from past transactions" picker so the user can seed
        a manual recurring off ANY frequent transaction — not just the ones
        detect_recurring flags as truly periodic. Ordered by occurrence count
        so the most-common merchants surface first."""
        from datetime import date
        from collections import defaultdict

        rows = self.conn.execute(
            "SELECT date, description, CAST(amount AS REAL) AS amount FROM transactions "
            "ORDER BY description, date"
        ).fetchall()

        normalize = self._normalize_desc
        groups: dict[str, list[tuple]] = defaultdict(list)
        for r in rows:
            key = normalize(r["description"])
            if not key:
                continue
            groups[key].append((r["date"], r["amount"], r["description"]))

        results = []
        for _key, entries in groups.items():
            if len(entries) < min_occurrences:
                continue
            entries.sort(key=lambda x: x[0])
            amounts = [abs(e[1]) for e in entries]
            avg_amount = sum(amounts) / len(amounts)

            # Median interval for display — may be wildly irregular, that's fine.
            intervals: list[int] = []
            for i in range(1, len(entries)):
                try:
                    d1 = date.fromisoformat(entries[i - 1][0])
                    d2 = date.fromisoformat(entries[i][0])
                    intervals.append((d2 - d1).days)
                except Exception:
                    pass
            median_interval = 0
            interval_type = "irregular"
            if intervals:
                sorted_intervals = sorted(intervals)
                median_interval = sorted_intervals[len(sorted_intervals) // 2]
                if 5 <= median_interval <= 9:
                    interval_type = "weekly"
                elif 12 <= median_interval <= 17:
                    interval_type = "biweekly"
                elif 25 <= median_interval <= 35:
                    interval_type = "monthly"
                elif 55 <= median_interval <= 95:
                    interval_type = "quarterly"
                elif 340 <= median_interval <= 380:
                    interval_type = "yearly"

            is_expense = entries[-1][1] < 0

            results.append({
                "description": entries[-1][2],
                "occurrences": len(entries),
                "avg_amount": round(avg_amount, 2),
                "avg_interval": round(median_interval, 0),
                "interval_type": interval_type,
                "last_date": entries[-1][0],
                "is_expense": is_expense,
            })

        # Sort by occurrence count (most frequent first) so the most-relevant
        # candidates show near the top. Ties broken by recency.
        results.sort(key=lambda x: (x["occurrences"], x["last_date"]), reverse=True)
        return results[:limit]

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

    # ------------------------------------------------------------------
    # Activity log — general audit trail with undo support
    # ------------------------------------------------------------------

    def _log_activity(self, action: str, description: str,
                      undo_payload: dict | None = None) -> int:
        """Append an activity entry. If undo_payload is provided, the entry
        is undoable via undo_activity()."""
        import json as json_mod
        from datetime import datetime
        cur = self.conn.execute(
            "INSERT INTO activity_log (at, action, description, undo_payload) "
            "VALUES (?, ?, ?, ?)",
            (datetime.now().isoformat(), action, description,
             json_mod.dumps(undo_payload) if undo_payload else None),
        )
        # Don't commit here — caller's own commit will pick it up.
        return cur.lastrowid

    def get_activity_log(self, limit: int = 200) -> list[dict]:
        rows = self.conn.execute(
            "SELECT id, at, action, description, "
            "       (undo_payload IS NOT NULL) AS undoable, reverted_at "
            "FROM activity_log ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [{k: r[k] for k in r.keys()} for r in rows]

    def undo_activity(self, activity_id: int) -> dict:
        """Reverse a previously-logged action. Only entries with an
        undo_payload can be undone; each action type has its own reversal
        logic here."""
        import json as json_mod
        from datetime import datetime
        row = self.conn.execute(
            "SELECT action, description, undo_payload, reverted_at "
            "FROM activity_log WHERE id = ?", (activity_id,),
        ).fetchone()
        if not row:
            raise ValueError("Activity not found")
        if row["reverted_at"]:
            raise ValueError("This action was already undone")
        if not row["undo_payload"]:
            raise ValueError("This action cannot be undone")

        payload = json_mod.loads(row["undo_payload"])
        action = row["action"]

        self._suppress_log = True
        try:
            return self._do_undo(activity_id, action, payload)
        finally:
            self._suppress_log = False

    def _do_undo(self, activity_id: int, action: str, payload: dict) -> dict:
        import json as json_mod
        from datetime import datetime
        if action == "delete_tx":
            # Re-insert the deleted transaction row
            r = payload["row"]
            self.conn.execute(
                "INSERT OR IGNORE INTO transactions "
                "(id, date, description, raw_description, amount, account_id, "
                " category_id, user, is_manual) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (r["id"], r["date"], r["description"], r["raw_description"],
                 r["amount"], r["account_id"], r["category_id"], r["user"],
                 r.get("is_manual", 0)),
            )
            # Re-apply balance adjustments
            if r["category_id"]:
                acc = self.conn.execute(
                    "SELECT account_type FROM accounts WHERE id = ?", (r["account_id"],)
                ).fetchone()
                from_sav = bool(acc and acc["account_type"] == "savings")
                self._adjust_linked_balance(r["category_id"], Decimal(r["amount"]), from_sav)

        elif action == "bulk_delete":
            # Re-insert every deleted row
            for r in payload["rows"]:
                self.conn.execute(
                    "INSERT OR IGNORE INTO transactions "
                    "(id, date, description, raw_description, amount, account_id, "
                    " category_id, user, is_manual) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (r["id"], r["date"], r["description"], r["raw_description"],
                     r["amount"], r["account_id"], r["category_id"], r["user"],
                     r.get("is_manual", 0)),
                )
                if r["category_id"]:
                    acc = self.conn.execute(
                        "SELECT account_type FROM accounts WHERE id = ?", (r["account_id"],)
                    ).fetchone()
                    from_sav = bool(acc and acc["account_type"] == "savings")
                    self._adjust_linked_balance(r["category_id"], Decimal(r["amount"]), from_sav)

        elif action == "set_category":
            # Restore old category on every affected tx
            for entry in payload["changes"]:
                self.set_category(entry["tx_id"], entry["old_category"] or "")

        elif action == "flip_sign":
            # Flip again to restore
            self.flip_transaction_sign(payload["tx_id"])

        elif action == "add_tx":
            # Delete the added tx
            self.delete_transaction(payload["tx_id"])

        elif action == "split_create":
            # Reverse the split
            self.delete_split(payload["split_id"])

        else:
            raise ValueError(f"Undo not supported for action '{action}'")

        self.conn.execute(
            "UPDATE activity_log SET reverted_at = ? WHERE id = ?",
            (datetime.now().isoformat(), activity_id),
        )
        self.conn.commit()
        return {"undone": action}

    def log_import(self, account_id: str, filename: str, inserted: int,
                   tx_ids: list[str] | None = None) -> int:
        """Record an import batch and return its id so callers can offer undo/move."""
        import json
        from datetime import datetime
        tx_ids_json = json.dumps(tx_ids) if tx_ids else None
        cur = self.conn.execute(
            "INSERT INTO import_log (account_id, filename, imported_at, inserted, tx_ids) "
            "VALUES (?,?,?,?,?)",
            (account_id, filename, datetime.now().isoformat(), inserted, tx_ids_json),
        )
        self.conn.commit()
        return cur.lastrowid

    def undo_import(self, log_id: int) -> dict:
        """Delete every transaction that this import inserted (uses the stored
        tx_ids list). Balance adjustments on debts/savings/envelopes are reversed
        via delete_transaction(). Marks the log entry as reverted."""
        import json
        from datetime import datetime
        row = self.conn.execute(
            "SELECT tx_ids, reverted_at FROM import_log WHERE id = ?", (log_id,)
        ).fetchone()
        if not row:
            raise ValueError("Import not found")
        if row["reverted_at"]:
            raise ValueError("This import was already undone")
        if not row["tx_ids"]:
            raise ValueError("This import predates undo tracking — no tx_ids stored")
        tx_ids = json.loads(row["tx_ids"])
        deleted = 0
        for tid in tx_ids:
            existed = self.conn.execute(
                "SELECT 1 FROM transactions WHERE id = ?", (tid,)
            ).fetchone()
            if existed:
                self.delete_transaction(tid)
                deleted += 1
        self.conn.execute(
            "UPDATE import_log SET reverted_at = ? WHERE id = ?",
            (datetime.now().isoformat(), log_id),
        )
        self.conn.commit()
        return {"deleted": deleted}

    def move_import(self, log_id: int, new_account_id: str) -> dict:
        """Reassign every transaction from this import to a different account.
        Useful when the user picked the wrong account. Transaction IDs stay
        stable (they include the old account_id in the hash) — we just update
        the account_id column."""
        import json
        row = self.conn.execute(
            "SELECT tx_ids, account_id, reverted_at FROM import_log WHERE id = ?", (log_id,)
        ).fetchone()
        if not row:
            raise ValueError("Import not found")
        if row["reverted_at"]:
            raise ValueError("Cannot move — this import was already undone")
        if not row["tx_ids"]:
            raise ValueError("This import predates undo tracking — no tx_ids stored")
        if new_account_id == row["account_id"]:
            return {"moved": 0, "note": "Already on that account"}
        tx_ids = json.loads(row["tx_ids"])
        moved = 0
        for tid in tx_ids:
            cur = self.conn.execute(
                "UPDATE transactions SET account_id = ? WHERE id = ?",
                (new_account_id, tid),
            )
            moved += cur.rowcount
        self.conn.execute(
            "UPDATE import_log SET account_id = ? WHERE id = ?",
            (new_account_id, log_id),
        )
        self.conn.commit()
        return {"moved": moved}

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
    # Financial Health Metrics
    # ------------------------------------------------------------------

    def get_financial_health(self) -> dict:
        """Compute 5 CFP-style financial health ratios and a composite score."""
        from decimal import Decimal

        # Gather data via bridge-level helpers — call repo methods directly
        # to avoid circular import.  We build a snapshot manually.
        from datetime import date, timedelta

        n = 3  # months to average
        today = date.today()
        first_of_current = today.replace(day=1)
        end_date = first_of_current - timedelta(days=1)
        start_date = end_date.replace(day=1)
        for _ in range(n - 1):
            start_date = (start_date - timedelta(days=1)).replace(day=1)

        bucket_rows = self.conn.execute(
            """SELECT c.bucket, SUM(CAST(t.amount AS REAL)) AS total
               FROM transactions t
               JOIN categories c ON t.category_id = c.id
               WHERE t.date >= ? AND t.date <= ? AND c.bucket != 'transfers'
               GROUP BY c.bucket""",
            (start_date.isoformat(), end_date.isoformat()),
        ).fetchall()
        by_bucket = {r["bucket"]: Decimal(str(r["total"])) for r in bucket_rows}

        monthly_income = by_bucket.get("income", Decimal("0")) / n
        monthly_bills = abs(by_bucket.get("bills", Decimal("0"))) / n
        monthly_subs = abs(by_bucket.get("subscriptions", Decimal("0"))) / n
        monthly_expenses = abs(by_bucket.get("expenses", Decimal("0"))) / n
        monthly_debt_payments = abs(by_bucket.get("debts", Decimal("0"))) / n
        monthly_savings = abs(by_bucket.get("savings", Decimal("0"))) / n

        total_outflow = monthly_bills + monthly_subs + monthly_expenses + monthly_debt_payments + monthly_savings

        # Total savings balance
        trackers = self.get_savings_trackers()
        total_savings_balance = sum(Decimal(t.get("balance") or "0") for t in trackers)

        # Debt minimums
        debts = self.get_debts()
        total_minimums = sum(Decimal(d.get("minimum") or "0") for d in debts)

        # Monthly essentials for emergency fund calc
        monthly_essentials = monthly_bills + monthly_subs + monthly_expenses

        # Category budget adherence
        cat_rows = self.conn.execute(
            """SELECT t.category_id, c.budget_amount,
                      ABS(SUM(CAST(t.amount AS REAL))) AS total_spent
               FROM transactions t
               JOIN categories c ON t.category_id = c.id
               WHERE t.date LIKE ? AND c.bucket NOT IN ('transfers', 'income')
                 AND c.budget_amount IS NOT NULL
               GROUP BY t.category_id""",
            (f"{today.strftime('%Y-%m')}-%",),
        ).fetchall()
        cats_with_budget = len(cat_rows)
        cats_at_or_under = sum(
            1 for r in cat_rows
            if Decimal(str(r["total_spent"])) <= Decimal(r["budget_amount"])
        )

        # ── Compute 5 metrics ───────────────────────────────────────
        metrics = []

        # 1. Emergency Fund Ratio
        if monthly_essentials > 0:
            ef_ratio = float(total_savings_balance / monthly_essentials)
        else:
            ef_ratio = float(total_savings_balance) if total_savings_balance > 0 else 0.0
        if ef_ratio >= 6:
            ef_status = "healthy"
        elif ef_ratio >= 3:
            ef_status = "watch"
        else:
            ef_status = "action"
        metrics.append({
            "name": "Emergency Fund",
            "value": round(ef_ratio, 1),
            "formatted": f"{ef_ratio:.1f} months",
            "status": ef_status,
            "target": "6 months",
            "description": "Months of essential expenses covered by savings",
        })

        # 2. Debt-to-Income
        if monthly_income > 0:
            dti = float(total_minimums / monthly_income)
        else:
            dti = 0.0
        if dti < 0.20:
            dti_status = "healthy"
        elif dti <= 0.36:
            dti_status = "watch"
        else:
            dti_status = "action"
        metrics.append({
            "name": "Debt-to-Income",
            "value": round(dti, 3),
            "formatted": f"{dti * 100:.1f}%",
            "status": dti_status,
            "target": "Under 20%",
            "description": "Monthly debt minimums as percentage of income",
        })

        # 3. Savings Rate
        if monthly_income > 0:
            savings_rate = float((monthly_savings + monthly_debt_payments) / monthly_income)
        else:
            savings_rate = 0.0
        if savings_rate >= 0.20:
            sr_status = "healthy"
        elif savings_rate >= 0.10:
            sr_status = "watch"
        else:
            sr_status = "action"
        metrics.append({
            "name": "Savings Rate",
            "value": round(savings_rate, 3),
            "formatted": f"{savings_rate * 100:.1f}%",
            "status": sr_status,
            "target": "20%+",
            "description": "Savings + debt payments as percentage of income",
        })

        # 4. Fixed vs Variable (Flexibility)
        if total_outflow > 0:
            fixed_ratio = float(
                (monthly_bills + monthly_subs + monthly_debt_payments) / total_outflow
            )
        else:
            fixed_ratio = 0.0
        if fixed_ratio < 0.60:
            flex_status = "healthy"
        elif fixed_ratio <= 0.70:
            flex_status = "watch"
        else:
            flex_status = "action"
        metrics.append({
            "name": "Fixed vs Variable",
            "value": round(fixed_ratio, 3),
            "formatted": f"{fixed_ratio * 100:.1f}%",
            "status": flex_status,
            "target": "Under 60%",
            "description": "Fixed costs (bills + subs + debt) as share of total outflow",
        })

        # 5. Budget Adherence
        if cats_with_budget > 0:
            adherence = cats_at_or_under / cats_with_budget
        else:
            adherence = 1.0  # no budgets set → not penalized
        if adherence >= 0.80:
            adh_status = "healthy"
        elif adherence >= 0.50:
            adh_status = "watch"
        else:
            adh_status = "action"
        metrics.append({
            "name": "Budget Adherence",
            "value": round(adherence, 3),
            "formatted": f"{adherence * 100:.0f}%",
            "status": adh_status,
            "target": "80%+",
            "description": "Percentage of budgeted categories at or under budget",
        })

        # ── Composite score (0-100) ─────────────────────────────────
        def _score(metric: dict) -> float:
            """Map a metric to a 0-1 score based on its thresholds."""
            name = metric["name"]
            v = metric["value"]
            if name == "Emergency Fund":
                return min(1.0, v / 6.0)
            elif name == "Debt-to-Income":
                if v <= 0.0:
                    return 1.0
                if v < 0.20:
                    return 1.0 - (v / 0.20) * 0.2
                if v <= 0.36:
                    return 0.6 - ((v - 0.20) / 0.16) * 0.3
                return max(0.0, 0.3 - ((v - 0.36) / 0.24) * 0.3)
            elif name == "Savings Rate":
                return min(1.0, v / 0.20)
            elif name == "Fixed vs Variable":
                if v < 0.60:
                    return 1.0
                if v <= 0.70:
                    return 0.8 - ((v - 0.60) / 0.10) * 0.3
                return max(0.0, 0.5 - ((v - 0.70) / 0.30) * 0.5)
            elif name == "Budget Adherence":
                return min(1.0, v / 0.80) if v < 0.80 else 1.0
            return 0.5

        weights = {
            "Emergency Fund": 0.30,
            "Savings Rate": 0.25,
            "Debt-to-Income": 0.20,
            "Budget Adherence": 0.15,
            "Fixed vs Variable": 0.10,
        }
        composite = sum(weights.get(m["name"], 0) * _score(m) for m in metrics)
        score = round(composite * 100, 1)

        return {"metrics": metrics, "score": score}

    # ------------------------------------------------------------------
    # Proactive Insights
    # ------------------------------------------------------------------

    def get_insights(self) -> list[dict]:
        """Return a list of proactive financial insights."""
        from datetime import date, timedelta
        from decimal import Decimal
        from collections import defaultdict

        today = date.today()
        insights: list[dict] = []

        # Helper: get monthly spend by bucket for a given YYYY-MM
        def _monthly_bucket_spend(yyyy_mm: str) -> dict[str, Decimal]:
            rows = self.conn.execute(
                """SELECT c.bucket, SUM(CAST(t.amount AS REAL)) AS total
                   FROM transactions t
                   JOIN categories c ON t.category_id = c.id
                   WHERE t.date LIKE ? AND c.bucket NOT IN ('transfers', 'income')
                   GROUP BY c.bucket""",
                (f"{yyyy_mm}-%",),
            ).fetchall()
            return {r["bucket"]: abs(Decimal(str(r["total"]))) for r in rows}

        def _monthly_category_spend(yyyy_mm: str) -> dict[str, Decimal]:
            rows = self.conn.execute(
                """SELECT t.category_id, c.name, c.bucket,
                          ABS(SUM(CAST(t.amount AS REAL))) AS total
                   FROM transactions t
                   JOIN categories c ON t.category_id = c.id
                   WHERE t.date LIKE ? AND c.bucket NOT IN ('transfers', 'income')
                   GROUP BY t.category_id""",
                (f"{yyyy_mm}-%",),
            ).fetchall()
            return {r["category_id"]: {"name": r["name"], "bucket": r["bucket"],
                                       "total": Decimal(str(r["total"]))} for r in rows}

        # Current and past months
        current_month = today.strftime("%Y-%m")
        past_months = []
        d = today.replace(day=1)
        for _ in range(6):
            d = (d - timedelta(days=1)).replace(day=1)
            past_months.append(d.strftime("%Y-%m"))
        past_months.reverse()

        # 1. Spending anomaly: current month vs 3-month average by bucket
        if len(past_months) >= 3:
            recent_3 = past_months[-3:]
            avg_by_bucket: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
            for m in recent_3:
                for bucket, total in _monthly_bucket_spend(m).items():
                    avg_by_bucket[bucket] += total / 3
            current_spend = _monthly_bucket_spend(current_month)
            for bucket, current_val in current_spend.items():
                if bucket in ("income",):
                    continue
                avg = avg_by_bucket.get(bucket, Decimal("0"))
                if avg > 0 and current_val > avg * Decimal("1.3"):
                    pct_over = float((current_val - avg) / avg * 100)
                    insights.append({
                        "type": "spending_anomaly",
                        "severity": "warning",
                        "title": f"{bucket.title()} spending is {pct_over:.0f}% above average",
                        "body": (
                            f"You've spent ${float(current_val):,.2f} on {bucket} this month, "
                            f"vs a 3-month average of ${float(avg):,.2f}."
                        ),
                    })

        # 2. Subscription creep: check if subscriptions increased 3+ consecutive months
        if len(past_months) >= 3:
            sub_totals = []
            for m in past_months[-4:] if len(past_months) >= 4 else past_months[-3:]:
                spend = _monthly_bucket_spend(m)
                sub_totals.append(spend.get("subscriptions", Decimal("0")))
            increasing_streak = 0
            for i in range(1, len(sub_totals)):
                if sub_totals[i] > sub_totals[i - 1]:
                    increasing_streak += 1
                else:
                    increasing_streak = 0
            if increasing_streak >= 3:
                insights.append({
                    "type": "subscription_creep",
                    "severity": "warning",
                    "title": "Subscription costs rising steadily",
                    "body": (
                        f"Your subscription spending has increased for {increasing_streak} "
                        f"consecutive months. Consider auditing for unused services."
                    ),
                })

        # 3. Income variability
        if len(past_months) >= 3:
            income_totals = []
            for m in past_months[-6:]:
                rows = self.conn.execute(
                    """SELECT SUM(CAST(t.amount AS REAL)) AS total
                       FROM transactions t
                       JOIN categories c ON t.category_id = c.id
                       WHERE t.date LIKE ? AND c.bucket = 'income'""",
                    (f"{m}-%",),
                ).fetchall()
                val = float(rows[0]["total"] or 0) if rows else 0.0
                if val > 0:
                    income_totals.append(val)
            if len(income_totals) >= 3:
                import statistics
                mean_inc = statistics.mean(income_totals)
                if mean_inc > 0:
                    stdev_inc = statistics.stdev(income_totals)
                    cv = stdev_inc / mean_inc
                    if cv > 0.15:
                        insights.append({
                            "type": "income_variability",
                            "severity": "info",
                            "title": "Income varies significantly month-to-month",
                            "body": (
                                f"Your income coefficient of variation is {cv * 100:.0f}%. "
                                f"Consider building a larger emergency fund to buffer volatility."
                            ),
                        })

        # 4. Emergency fund gap
        trackers = self.get_savings_trackers()
        total_savings = sum(Decimal(t.get("balance") or "0") for t in trackers)
        if past_months:
            recent_3 = past_months[-3:]
            essentials = Decimal("0")
            for m in recent_3:
                spend = _monthly_bucket_spend(m)
                for b in ("bills", "subscriptions", "expenses"):
                    essentials += spend.get(b, Decimal("0"))
            monthly_essentials = essentials / max(1, len(recent_3))
            if monthly_essentials > 0:
                months_covered = total_savings / monthly_essentials
                if months_covered < 3:
                    gap = (monthly_essentials * 3) - total_savings
                    insights.append({
                        "type": "emergency_fund_gap",
                        "severity": "action",
                        "title": "Emergency fund below 3-month target",
                        "body": (
                            f"You have {float(months_covered):.1f} months of essential expenses saved. "
                            f"You need ${float(gap):,.2f} more to reach a 3-month cushion."
                        ),
                    })

        # 5. Budget gaps: categories with spending but no budget_amount
        cat_rows = self.conn.execute(
            """SELECT c.id, c.name, c.bucket, c.budget_amount,
                      ABS(SUM(CAST(t.amount AS REAL))) AS total
               FROM transactions t
               JOIN categories c ON t.category_id = c.id
               WHERE t.date LIKE ? AND c.bucket NOT IN ('transfers', 'income')
                 AND c.budget_amount IS NULL
               GROUP BY c.id
               HAVING total > 0
               ORDER BY total DESC""",
            (f"{current_month}-%",),
        ).fetchall()
        if len(cat_rows) >= 3:
            names = [r["name"] for r in cat_rows[:5]]
            insights.append({
                "type": "budget_gaps",
                "severity": "info",
                "title": f"{len(cat_rows)} spending categories have no budget set",
                "body": (
                    f"Categories like {', '.join(names)} have spending but no budget. "
                    f"Setting budgets helps track overspending."
                ),
            })

        # 6. Debt momentum
        debts = self.get_debts()
        for d in debts:
            balance = Decimal(d.get("balance") or "0")
            minimum = Decimal(d.get("minimum") or "0")
            apr = Decimal(d.get("apr") or "0")
            if balance > 0 and minimum > 0:
                monthly_rate = apr / 100 / 12
                if minimum > balance * monthly_rate:
                    # Months to payoff
                    import math
                    if monthly_rate > 0:
                        months = math.ceil(
                            -math.log(1 - float(balance * monthly_rate / minimum))
                            / math.log(1 + float(monthly_rate))
                        )
                    else:
                        months = math.ceil(float(balance / minimum))
                    payoff_date = today + timedelta(days=months * 30)
                    severity = "success" if months <= 12 else "info"
                    insights.append({
                        "type": "debt_momentum",
                        "severity": severity,
                        "title": f"{d['name']}: ~{months} months to payoff",
                        "body": (
                            f"At current minimum of ${float(minimum):,.2f}/mo, "
                            f"estimated payoff around {payoff_date.strftime('%B %Y')}."
                        ),
                    })

        return insights

    # ------------------------------------------------------------------
    # Dashboard Notifications
    # ------------------------------------------------------------------

    def get_notifications(self) -> list[dict]:
        """Return urgent alerts for Dashboard banners."""
        from datetime import date, timedelta
        from decimal import Decimal

        today = date.today()
        notifications: list[dict] = []

        # 1. Bills due within 5 days
        upcoming = self.get_upcoming_scheduled(days_ahead=5)
        for item in upcoming:
            if item.get("source") in ("debt", "manual", "recurring"):
                try:
                    due = date.fromisoformat(item["date"])
                    days_until = (due - today).days
                except Exception:
                    continue
                if 0 <= days_until <= 5:
                    notifications.append({
                        "type": "bill_due",
                        "severity": "warning" if days_until <= 2 else "info",
                        "title": f"{item['label']} due {'today' if days_until == 0 else f'in {days_until} day' + ('s' if days_until != 1 else '')}",
                        "body": f"Amount: ${float(Decimal(item.get('amount') or '0')):,.2f}" if item.get("amount") else "",
                        "action_view": "calendar",
                    })

        # 2. Budget categories at >80% utilization
        current_month = today.strftime("%Y-%m")
        cat_rows = self.conn.execute(
            """SELECT t.category_id, c.name, c.budget_amount,
                      ABS(SUM(CAST(t.amount AS REAL))) AS total_spent
               FROM transactions t
               JOIN categories c ON t.category_id = c.id
               WHERE t.date LIKE ? AND c.bucket NOT IN ('transfers', 'income')
                 AND c.budget_amount IS NOT NULL
               GROUP BY t.category_id""",
            (f"{current_month}-%",),
        ).fetchall()
        for r in cat_rows:
            try:
                spent = Decimal(str(r["total_spent"]))
                budget = Decimal(r["budget_amount"])
                if budget > 0:
                    utilization = spent / budget
                    if utilization > Decimal("1.0"):
                        notifications.append({
                            "type": "budget_exceeded",
                            "severity": "action",
                            "title": f"{r['name']} is over budget",
                            "body": f"Spent ${float(spent):,.2f} of ${float(budget):,.2f} budget ({float(utilization * 100):.0f}%)",
                            "action_view": "transactions",
                        })
                    elif utilization > Decimal("0.8"):
                        notifications.append({
                            "type": "budget_warning",
                            "severity": "warning",
                            "title": f"{r['name']} is at {float(utilization * 100):.0f}% of budget",
                            "body": f"Spent ${float(spent):,.2f} of ${float(budget):,.2f}",
                            "action_view": "transactions",
                        })
            except Exception:
                continue

        # 3. Debt milestones
        debts = self.get_debts()
        for d in debts:
            balance = Decimal(d.get("balance") or "0")
            if balance <= 0:
                continue
            # Approximate historical max: current balance + total payments made
            # (sum of negative transactions against the debt's category)
            cat_id = d.get("category_id")
            if cat_id:
                paid_row = self.conn.execute(
                    """SELECT ABS(SUM(CAST(amount AS REAL))) AS total_paid
                       FROM transactions
                       WHERE category_id = ? AND CAST(amount AS REAL) < 0""",
                    (cat_id,),
                ).fetchone()
                total_paid = Decimal(str(paid_row["total_paid"] or "0"))
            else:
                total_paid = Decimal("0")
            historical_max = balance + total_paid
            if historical_max > 0 and total_paid > 0:
                remaining_pct = float(balance / historical_max)
                if remaining_pct <= 0.25:
                    notifications.append({
                        "type": "debt_milestone",
                        "severity": "success",
                        "title": f"{d['name']}: under 25% remaining!",
                        "body": f"Balance ${float(balance):,.2f} — you've paid off over 75% of this debt.",
                        "action_view": "debts",
                    })
                elif remaining_pct <= 0.50:
                    notifications.append({
                        "type": "debt_milestone",
                        "severity": "success",
                        "title": f"{d['name']}: halfway paid off!",
                        "body": f"Balance ${float(balance):,.2f} — you've paid off over 50%.",
                        "action_view": "debts",
                    })
                elif remaining_pct <= 0.75:
                    notifications.append({
                        "type": "debt_milestone",
                        "severity": "info",
                        "title": f"{d['name']}: 25% paid off",
                        "body": f"Balance ${float(balance):,.2f} — keep going!",
                        "action_view": "debts",
                    })

        return notifications

    # ------------------------------------------------------------------
    # Net Worth Snapshots
    # ------------------------------------------------------------------

    def snapshot_net_worth(self) -> None:
        """Upsert the current month's net worth snapshot."""
        from datetime import datetime
        from decimal import Decimal

        nw = self.get_net_worth()
        month = datetime.now().strftime("%Y-%m")
        self.conn.execute(
            """INSERT INTO net_worth_snapshots
               (month, total_assets, total_savings, total_debts, net_worth, snapshot_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(month) DO UPDATE SET
                 total_assets=excluded.total_assets,
                 total_savings=excluded.total_savings,
                 total_debts=excluded.total_debts,
                 net_worth=excluded.net_worth,
                 snapshot_at=excluded.snapshot_at""",
            (
                month,
                str(nw["total_assets"]),
                str(nw["total_savings"]),
                str(nw["total_debts"]),
                str(nw["net_worth"]),
                datetime.now().isoformat(),
            ),
        )
        self.conn.commit()

    def get_net_worth_history(self, n: int = 12) -> list[dict]:
        """Return the last N monthly net worth snapshots."""
        rows = self.conn.execute(
            "SELECT * FROM net_worth_snapshots ORDER BY month DESC LIMIT ?",
            (n,),
        ).fetchall()
        result = [{k: r[k] for k in r.keys()} for r in rows]
        result.reverse()  # chronological order
        return result

    # ------------------------------------------------------------------
    # Paycheck Configs
    # ------------------------------------------------------------------

    def get_paycheck_configs(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM paycheck_configs ORDER BY earner, id"
        ).fetchall()
        return [{k: r[k] for k in r.keys()} for r in rows]

    def save_paycheck_config(self, config: dict) -> None:
        self.conn.execute(
            """INSERT INTO paycheck_configs (id, earner, frequency, days, estimated_amount)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 earner=excluded.earner, frequency=excluded.frequency,
                 days=excluded.days, estimated_amount=excluded.estimated_amount""",
            (
                config["id"],
                config["earner"],
                config.get("frequency", "semimonthly"),
                config["days"],
                config.get("estimated_amount", "0"),
            ),
        )
        self.conn.commit()

    def delete_paycheck_config(self, config_id: str) -> None:
        self.conn.execute("DELETE FROM paycheck_configs WHERE id = ?", (config_id,))
        self.conn.commit()

    # ------------------------------------------------------------------
    # Paycheck Plan
    # ------------------------------------------------------------------

    def get_paycheck_plan(self, paycheck_date: str, next_paycheck_date: str) -> dict:
        """Compute a bill allocation plan between two paycheck dates."""
        from datetime import date, timedelta
        from decimal import Decimal

        pay_date = date.fromisoformat(paycheck_date)
        next_date = date.fromisoformat(next_paycheck_date)

        # Estimated income from paycheck configs
        configs = self.get_paycheck_configs()
        estimated_income = Decimal("0")
        for cfg in configs:
            # Check if any pay day falls on or near the paycheck_date
            days = [int(d.strip()) for d in cfg["days"].split(",") if d.strip()]
            for day in days:
                try:
                    check_date = pay_date.replace(day=min(day, 28))
                except ValueError:
                    continue
                if abs((check_date - pay_date).days) <= 2:
                    estimated_income += Decimal(cfg.get("estimated_amount") or "0")
                    break
        # If no config matched, use average monthly income / 2 as estimate
        if estimated_income == 0:
            from datetime import timedelta
            n = 3
            today = date.today()
            first_of_current = today.replace(day=1)
            end_d = first_of_current - timedelta(days=1)
            start_d = end_d.replace(day=1)
            for _ in range(n - 1):
                start_d = (start_d - timedelta(days=1)).replace(day=1)
            inc_row = self.conn.execute(
                """SELECT SUM(CAST(t.amount AS REAL)) AS total
                   FROM transactions t
                   JOIN categories c ON t.category_id = c.id
                   WHERE t.date >= ? AND t.date <= ? AND c.bucket = 'income'""",
                (start_d.isoformat(), end_d.isoformat()),
            ).fetchone()
            monthly_avg = Decimal(str(inc_row["total"] or "0")) / n
            estimated_income = monthly_avg / 2  # assume semi-monthly

        # Find all scheduled items between the two dates
        items: list[dict] = []
        total_required = Decimal("0")

        # Debt due dates
        debts = self.get_debts()
        for d in debts:
            due_day = d.get("due_day")
            if not due_day:
                continue
            minimum = Decimal(d.get("minimum") or "0")
            # Check if due_day falls in range
            import calendar as cal_mod
            for month_offset in range(3):
                anchor = (pay_date.replace(day=1) + timedelta(days=32 * month_offset)).replace(day=1)
                last_day = cal_mod.monthrange(anchor.year, anchor.month)[1]
                actual_day = min(int(due_day), last_day)
                try:
                    due_date = date(anchor.year, anchor.month, actual_day)
                except ValueError:
                    continue
                if pay_date <= due_date < next_date:
                    items.append({
                        "label": d["name"],
                        "due_date": due_date.isoformat(),
                        "amount": str(minimum),
                        "type": "debt",
                        "apr": d.get("apr"),
                        "balance": d.get("balance"),
                    })
                    total_required += minimum
                    break

        # Manual recurring in range
        for rec in self.get_manual_recurring():
            amt = Decimal(rec.get("amount") or "0")
            if amt >= 0:
                continue  # skip income entries
            range_end = next_date - timedelta(days=1)
            for occ in self._project_manual_occurrences(rec, pay_date, range_end):
                items.append({
                    "label": rec["label"],
                    "due_date": occ.isoformat(),
                    "amount": str(abs(amt)),
                    "type": "recurring",
                    "apr": None,
                    "balance": None,
                })
                total_required += abs(amt)

        extra_available = estimated_income - total_required
        interest_saved = Decimal("0")

        # Allocate extra to highest-APR debt (avalanche)
        extra_allocations: list[dict] = []
        if extra_available > 0:
            debt_items = [i for i in items if i["type"] == "debt" and i.get("apr")]
            debt_items.sort(key=lambda x: Decimal(x["apr"] or "0"), reverse=True)

            remaining_extra = extra_available
            for di in debt_items:
                if remaining_extra <= 0:
                    break
                apr = Decimal(di.get("apr") or "0")
                balance = Decimal(di.get("balance") or "0")
                minimum = Decimal(di.get("amount") or "0")
                headroom = max(Decimal("0"), balance - minimum)
                allocation = min(remaining_extra, headroom)
                if allocation > 0:
                    extra_allocations.append({
                        "label": di["label"],
                        "extra_amount": str(allocation),
                        "apr": di.get("apr"),
                    })
                    # Interest saved vs equal distribution: extra payment at this
                    # APR saves more than spreading it equally
                    monthly_rate = apr / 100 / 12
                    interest_saved += allocation * monthly_rate
                    remaining_extra -= allocation

        return {
            "paycheck_date": paycheck_date,
            "next_paycheck_date": next_paycheck_date,
            "estimated_income": str(estimated_income.quantize(Decimal("0.01"))),
            "items": items,
            "extra_allocations": extra_allocations,
            "totals": {
                "required": str(total_required.quantize(Decimal("0.01"))),
                "extra_available": str(max(Decimal("0"), extra_available).quantize(Decimal("0.01"))),
            },
            "remaining_variable": str(max(Decimal("0"), extra_available - sum(
                Decimal(a["extra_amount"]) for a in extra_allocations
            )).quantize(Decimal("0.01"))),
            "interest_saved_vs_equal": str(interest_saved.quantize(Decimal("0.01"))),
        }

    # ------------------------------------------------------------------
    # Budget Strategy (50/30/20)
    # ------------------------------------------------------------------

    def get_budget_strategy(self) -> dict:
        """Compute 50/30/20 analysis using 3-month budget snapshot."""
        from budgetapp.core.budget import compute_strategy
        from datetime import date, timedelta
        from decimal import Decimal

        n = 3
        today = date.today()
        first_of_current = today.replace(day=1)
        end_date = first_of_current - timedelta(days=1)
        start_date = end_date.replace(day=1)
        for _ in range(n - 1):
            start_date = (start_date - timedelta(days=1)).replace(day=1)

        bucket_rows = self.conn.execute(
            """SELECT c.bucket, SUM(CAST(t.amount AS REAL)) AS total
               FROM transactions t
               JOIN categories c ON t.category_id = c.id
               WHERE t.date >= ? AND t.date <= ? AND c.bucket != 'transfers'
               GROUP BY c.bucket""",
            (start_date.isoformat(), end_date.isoformat()),
        ).fetchall()
        by_bucket = {r["bucket"]: Decimal(str(r["total"])) for r in bucket_rows}

        snapshot = {
            "monthly_income": float(by_bucket.get("income", Decimal("0")) / n),
            "monthly_bills": float(abs(by_bucket.get("bills", Decimal("0"))) / n),
            "monthly_subscriptions": float(abs(by_bucket.get("subscriptions", Decimal("0"))) / n),
            "monthly_variable": float(abs(by_bucket.get("expenses", Decimal("0"))) / n),
            "monthly_debt_payments": float(abs(by_bucket.get("debts", Decimal("0"))) / n),
            "monthly_savings_contributions": float(abs(by_bucket.get("savings", Decimal("0"))) / n),
        }

        return compute_strategy(snapshot)

    # ------------------------------------------------------------------
    # Monthly Report
    # ------------------------------------------------------------------

    def get_monthly_report(self, month: str) -> dict:
        """Generate a monthly report card for a given YYYY-MM."""
        from decimal import Decimal
        from datetime import date, timedelta

        # Total income and expenses for the month
        bucket_rows = self.conn.execute(
            """SELECT c.bucket, SUM(CAST(t.amount AS REAL)) AS total
               FROM transactions t
               JOIN categories c ON t.category_id = c.id
               WHERE t.date LIKE ? AND c.bucket != 'transfers'
               GROUP BY c.bucket""",
            (f"{month}-%",),
        ).fetchall()
        by_bucket = {r["bucket"]: Decimal(str(r["total"])) for r in bucket_rows}

        income = by_bucket.get("income", Decimal("0"))
        total_expenses = Decimal("0")
        for b in ("bills", "subscriptions", "expenses", "debts", "savings"):
            total_expenses += abs(by_bucket.get(b, Decimal("0")))

        net = income - total_expenses

        # Budget adherence
        cat_rows = self.conn.execute(
            """SELECT t.category_id, c.name, c.bucket, c.budget_amount,
                      ABS(SUM(CAST(t.amount AS REAL))) AS total_spent
               FROM transactions t
               JOIN categories c ON t.category_id = c.id
               WHERE t.date LIKE ? AND c.bucket NOT IN ('transfers', 'income')
                 AND c.budget_amount IS NOT NULL
               GROUP BY t.category_id""",
            (f"{month}-%",),
        ).fetchall()
        cats_with_budget = len(cat_rows)
        cats_at_or_under = sum(
            1 for r in cat_rows
            if Decimal(str(r["total_spent"])) <= Decimal(r["budget_amount"])
        )
        adherence_pct = (cats_at_or_under / cats_with_budget * 100) if cats_with_budget > 0 else 100.0

        # Top 3 spending categories
        top_cats = self.conn.execute(
            """SELECT c.name, c.bucket,
                      ABS(SUM(CAST(t.amount AS REAL))) AS total
               FROM transactions t
               JOIN categories c ON t.category_id = c.id
               WHERE t.date LIKE ? AND c.bucket NOT IN ('transfers', 'income')
               GROUP BY t.category_id
               ORDER BY total DESC
               LIMIT 3""",
            (f"{month}-%",),
        ).fetchall()
        top_spending = [
            {"name": r["name"], "bucket": r["bucket"],
             "amount": float(Decimal(str(r["total"])))}
            for r in top_cats
        ]

        # Spiking categories (>30% above 3-month average)
        # Compute 3-month average for comparison
        try:
            report_date = date.fromisoformat(f"{month}-01")
        except Exception:
            report_date = date.today().replace(day=1)
        prior_months = []
        d = report_date
        for _ in range(3):
            d = (d - timedelta(days=1)).replace(day=1)
            prior_months.append(d.strftime("%Y-%m"))

        spikes: list[dict] = []
        if prior_months:
            avg_by_cat: dict[str, Decimal] = {}
            for pm in prior_months:
                pm_rows = self.conn.execute(
                    """SELECT t.category_id, c.name,
                              ABS(SUM(CAST(t.amount AS REAL))) AS total
                       FROM transactions t
                       JOIN categories c ON t.category_id = c.id
                       WHERE t.date LIKE ? AND c.bucket NOT IN ('transfers', 'income')
                       GROUP BY t.category_id""",
                    (f"{pm}-%",),
                ).fetchall()
                for r in pm_rows:
                    cid = r["category_id"]
                    avg_by_cat[cid] = avg_by_cat.get(cid, Decimal("0")) + Decimal(str(r["total"]))

            for cid in avg_by_cat:
                avg_by_cat[cid] = avg_by_cat[cid] / len(prior_months)

            current_cats = self.conn.execute(
                """SELECT t.category_id, c.name,
                          ABS(SUM(CAST(t.amount AS REAL))) AS total
                   FROM transactions t
                   JOIN categories c ON t.category_id = c.id
                   WHERE t.date LIKE ? AND c.bucket NOT IN ('transfers', 'income')
                   GROUP BY t.category_id""",
                (f"{month}-%",),
            ).fetchall()
            for r in current_cats:
                cid = r["category_id"]
                current_val = Decimal(str(r["total"]))
                avg_val = avg_by_cat.get(cid, Decimal("0"))
                if avg_val > 0 and current_val > avg_val * Decimal("1.3"):
                    pct = float((current_val - avg_val) / avg_val * 100)
                    spikes.append({
                        "name": r["name"],
                        "current": float(current_val),
                        "average": float(avg_val),
                        "pct_above": round(pct, 1),
                    })

        # Savings rate
        savings_rate = float((income - total_expenses + income) / income * 100 - 100) if income > 0 else 0.0
        # Simpler: savings_rate = net / income
        savings_rate = float(net / income * 100) if income > 0 else 0.0

        # Letter grade
        if income > 0:
            surplus_pct = float(net / income)
            if surplus_pct >= 0.15:
                grade = "A"
            elif surplus_pct >= 0.05:
                grade = "B"
            elif surplus_pct >= 0:
                grade = "C"
            elif surplus_pct >= -0.05:
                grade = "D"
            else:
                grade = "F"
        else:
            grade = "C"  # no income data

        return {
            "month": month,
            "total_income": float(income),
            "total_expenses": float(total_expenses),
            "net": float(net),
            "budget_adherence_pct": round(adherence_pct, 1),
            "categories_budgeted": cats_with_budget,
            "categories_at_or_under": cats_at_or_under,
            "top_spending": top_spending,
            "spikes": spikes,
            "savings_rate": round(savings_rate, 1),
            "grade": grade,
        }

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
