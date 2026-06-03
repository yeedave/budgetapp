import json
import os
from datetime import datetime
from pathlib import Path

import pandas as pd

from budgetapp.config.settings import ADVISOR_SKILLS_FILE, BACKUP_DIR, DB_PATH, SETTINGS_FILE
from budgetapp.core.categorizer import categorize
from budgetapp.parsers.apple import AppleParser
from budgetapp.parsers.chase import ChaseParser
from budgetapp.parsers.marcus import MarcusParser
from budgetapp.parsers.wells_fargo import WellsFargoParser
from budgetapp.storage.repository import Repository

# Tried in order during auto-detect import. Each parser raises ValueError if the
# PDF doesn't match its bank, so the first successful parse wins.
_AUTO_PARSERS = [ChaseParser, WellsFargoParser, AppleParser, MarcusParser]


def _tx_dict(row) -> dict:
    return {
        "id": row["id"],
        "date": row["date"].isoformat(),
        "description": row["description"],
        "amount": str(row["amount"]),
        "account_id": row["account_id"],
        "category_id": row["category_id"],
        "is_manual": bool(getattr(row, "is_manual", 0) or 0),
    }


class Api:
    """Exposed to the React frontend as window.pywebview.api."""

    def __init__(self) -> None:
        self._repo = Repository(DB_PATH)
        self._window = None  # injected after webview.create_window
        self._pending_df: "pd.DataFrame | None" = None
        self._pending_path: str = ""
        # Load saved API key into env so categorizer and advisor can use it
        saved = self.get_settings()
        if saved.get("anthropic_api_key") and not os.environ.get("ANTHROPIC_API_KEY"):
            os.environ["ANTHROPIC_API_KEY"] = saved["anthropic_api_key"]

    def set_window(self, window) -> None:
        self._window = window

    # ------------------------------------------------------------------
    # Ping
    # ------------------------------------------------------------------

    def ping(self) -> str:
        return "pong"

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def get_accounts(self) -> list[dict]:
        accounts = self._repo.get_accounts()
        return [{"id": a.id, "name": a.name, "bank": a.bank,
                 "account_type": a.account_type, "owner": a.owner,
                 "color": a.color, "sort_order": a.sort_order}
                for a in accounts]

    def get_categories(self) -> list[dict]:
        cats = self._repo.get_categories()
        return [{"id": c.id, "name": c.name, "bucket": c.bucket,
                 "owner": c.owner,
                 "budget_amount": str(c.budget_amount) if c.budget_amount is not None else None}
                for c in cats]

    def get_transactions(self, account_id: str = "", month: str = "") -> list[dict]:
        txs = self._repo.get_transactions(
            account_id=account_id or None,
            month=month or None,
        )
        return [_tx_dict({"id": t.id, "date": t.date, "description": t.description,
                          "amount": t.amount, "account_id": t.account_id,
                          "category_id": t.category_id, "is_manual": t.is_manual})
                for t in txs]

    def add_transaction(self, date: str, description: str, amount: str,
                        account_id: str, category_id: str = "") -> dict:
        tx = self._repo.add_manual_transaction(
            date, description, amount, account_id, category_id or None
        )
        return _tx_dict({"id": tx.id, "date": tx.date, "description": tx.description,
                         "amount": tx.amount, "account_id": tx.account_id,
                         "category_id": tx.category_id, "is_manual": tx.is_manual})

    def update_transaction_amount(self, tx_id: str, amount: str) -> dict:
        try:
            from decimal import Decimal, InvalidOperation
            Decimal(amount)  # validate
            self._repo.update_transaction_amount(tx_id, amount)
            return {"ok": True}
        except (InvalidOperation, ValueError) as exc:
            return {"ok": False, "error": str(exc)}

    def delete_transaction(self, tx_id: str) -> dict:
        try:
            self._repo.delete_transaction(tx_id)
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def count_transactions_range(self, start_date: str, end_date: str,
                                 account_id: str = "") -> int:
        return self._repo.count_transactions_range(start_date, end_date, account_id or None)

    def delete_transactions_range(self, start_date: str, end_date: str,
                                  account_id: str = "") -> dict:
        try:
            deleted = self._repo.delete_transactions_range(start_date, end_date, account_id or None)
            return {"ok": True, "deleted": deleted}
        except Exception as exc:
            return {"ok": False, "deleted": 0, "error": str(exc)}

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def set_category(self, tx_id: str, category_id: str) -> dict:
        updated_ids = self._repo.set_category(tx_id, category_id)
        return {"updated_ids": updated_ids}

    def get_importable_accounts(self) -> list[dict]:
        """Kept for API compatibility — always returns an empty list.
        Use import_any_statement() instead."""
        return []

    def add_account(self, name: str, bank: str, account_type: str, owner: str) -> dict:
        import re
        slug = re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')[:40]
        self._repo.upsert_account(slug, name, bank, account_type, owner)
        return {"id": slug, "name": name, "bank": bank,
                "account_type": account_type, "owner": owner, "color": None, "sort_order": None}

    def update_account(self, id: str, name: str, bank: str, account_type: str, owner: str,
                       color: str = "") -> None:
        self._repo.upsert_account(id, name, bank, account_type, owner, color or None)

    def save_account_color(self, account_id: str, color: str) -> None:
        self._repo.save_account_color(account_id, color or None)

    def save_account_order(self, ids: list) -> None:
        self._repo.save_account_order([str(i) for i in ids])

    def delete_account(self, account_id: str) -> dict:
        try:
            self._repo.delete_account(account_id)
            return {"ok": True}
        except ValueError as exc:
            return {"ok": False, "error": str(exc)}

    def get_orphaned_account_ids(self) -> list:
        return self._repo.get_orphaned_account_ids()

    def delete_transactions_for_account(self, account_id: str) -> dict:
        deleted = self._repo.delete_transactions_for_account(account_id)
        return {"ok": True, "deleted": deleted}

    def set_category_budget(self, category_id: str, budget_amount: str) -> None:
        self._repo.set_category_budget(category_id, budget_amount or None)

    def add_category(self, name: str, bucket: str, owner: str) -> dict:
        import re
        from budgetapp.core.models import Category
        slug = re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')
        cat_id = f"{bucket}_{slug}"[:48]
        cat = Category(id=cat_id, name=name, bucket=bucket, owner=owner)
        self._repo.upsert_category(cat)
        return {"id": cat_id, "name": name, "bucket": bucket, "owner": owner, "budget_amount": None}

    def delete_category(self, category_id: str) -> dict:
        try:
            self._repo.delete_category(category_id)
            return {"ok": True}
        except ValueError as exc:
            return {"ok": False, "error": str(exc)}

    def link_debt_category(self, debt_id: str, category_id: str) -> None:
        self._repo.link_debt_category(debt_id, category_id or None)

    def get_savings_trackers(self) -> list[dict]:
        return self._repo.get_savings_trackers()

    def save_savings_tracker(self, tracker: dict) -> None:
        import re
        t_id = tracker.get("id") or re.sub(r'[^a-z0-9]+', '_', tracker["name"].lower()).strip('_')[:40]
        self._repo.upsert_savings_tracker(
            id=t_id,
            name=tracker["name"],
            balance=tracker.get("balance") or "0",
            category_id=tracker.get("category_id") or None,
            goal_amount=tracker.get("goal_amount") or None,
            monthly_contribution=tracker.get("monthly_contribution") or None,
        )

    def delete_savings_tracker(self, tracker_id: str) -> None:
        self._repo.delete_savings_tracker(tracker_id)

    def get_debts(self) -> list[dict]:
        return self._repo.get_debts()

    def save_debt(self, debt: dict) -> dict:
        mr = debt.get("months_remaining")
        try:
            months_remaining = int(mr) if mr not in (None, "", "null") else None
        except (ValueError, TypeError):
            months_remaining = None
        return self._repo.upsert_debt(
            id=debt["id"],
            name=debt["name"],
            balance=debt.get("balance") or None,
            apr=debt.get("apr") or None,
            minimum=debt.get("minimum") or None,
            months_remaining=months_remaining,
        )

    def delete_debt(self, debt_id: str) -> None:
        self._repo.delete_debt(debt_id)

    def get_debt_plan(self, extra_monthly: str) -> dict:
        from decimal import Decimal
        from budgetapp.core.debt_planner import Debt, compare

        raw = self._repo.get_debts()
        debts, skipped = [], []
        for d in raw:
            if d["balance"] and d["apr"] and d["minimum"]:
                debts.append(Debt(name=d["name"], balance=d["balance"],
                                  apr=d["apr"], minimum=d["minimum"]))
            else:
                skipped.append(d["name"])

        if not debts:
            return {"error": "No debts have complete data yet (need balance, APR, and minimum payment).",
                    "skipped": skipped}

        try:
            extra = Decimal(extra_monthly or "0")
            av, sn = compare(debts, extra)
            baseline_months = compare(debts, Decimal("0"))[0].months if extra > 0 else None
        except Exception as exc:
            return {"error": str(exc), "skipped": skipped}

        def _timeline(r):
            by_month: dict[int, float] = {}
            for s in r.schedule:
                by_month[s.month] = by_month.get(s.month, 0.0) + float(s.balance)
            return [{"month": m, "balance": round(by_month[m], 2)}
                    for m in sorted(by_month)]

        def _r(r):
            return {
                "months": r.months,
                "years_months": r.years_months,
                "total_paid": str(r.total_paid),
                "total_interest": str(r.total_interest),
                "payoff_order": r.payoff_order,
                "timeline": _timeline(r),
            }

        starting_balance = str(sum(Decimal(d.balance) for d in debts))
        return {"avalanche": _r(av), "snowball": _r(sn),
                "starting_balance": starting_balance, "skipped": skipped,
                "baseline_months": baseline_months}

    def import_statement(self, account_id: str = "") -> dict:
        """Legacy shim — delegates to import_any_statement()."""
        return self.import_any_statement()

    def import_any_statement(self) -> dict:
        """Deprecated — account assignment requires user input. Use preview_statement + confirm_import."""
        return {"inserted": 0, "error": "Use 'Import Statement' to select and assign an account."}

    def preview_statement(self) -> dict:
        """Open file picker, parse PDF, store pending df — does NOT save to DB.
        Returns detected account info and transaction count for user confirmation."""
        import webview

        if self._window is None:
            return {"error": "Window not initialised"}

        paths = self._window.create_file_dialog(
            webview.OPEN_DIALOG,
            allow_multiple=False,
            file_types=("PDF files (*.pdf)",),
        )
        if not paths:
            return {"cancelled": True}

        pdf_path = Path(paths[0])
        df = None
        last_error = "Could not detect bank or statement format. Is this a supported PDF statement?"
        for parser_cls in _AUTO_PARSERS:
            try:
                candidate = parser_cls().parse(pdf_path)
                if len(candidate) > 0:
                    df = candidate
                    break
            except Exception as exc:
                last_error = str(exc)

        if df is None:
            return {"error": last_error}

        self._pending_df = df
        self._pending_path = pdf_path.name

        return {
            "detected_format": df.attrs.get("format_name", "Unknown format"),
            "count": len(df),
        }

    def confirm_import(self, force_account_id: str = "") -> dict:
        """Save the previously previewed statement under the given account_id."""
        if self._pending_df is None:
            return {"inserted": 0, "error": "No pending import — call preview_statement first"}
        if not force_account_id:
            return {"inserted": 0, "error": "An account must be selected before importing"}

        df = self._pending_df.copy()
        pdf_name = self._pending_path
        self._pending_df = None
        self._pending_path = ""

        df["account_id"] = force_account_id

        try:
            df = categorize(df, self._repo,
                            use_ai=bool(os.environ.get("ANTHROPIC_API_KEY")))
            inserted = self._repo.upsert_transactions(df)

            # Auto-update savings tracker if the parser emitted an ending balance
            # (Marcus HYSA statements carry the account's ending balance)
            ending_balance = df.attrs.get("ending_balance")
            if ending_balance and df.attrs.get("format_name") == "Marcus HYSA":
                trackers = self._repo.get_savings_trackers()
                # Match any tracker whose id or name mentions "marcus"
                linked = next(
                    (t for t in trackers if
                     "marcus" in t["id"].lower() or "marcus" in t["name"].lower()),
                    None
                )
                if linked:
                    self._repo.upsert_savings_tracker(
                        linked["id"], linked["name"], ending_balance,
                        linked.get("category_id"),
                    )

            self._repo.log_import(
                account_id=force_account_id,
                filename=pdf_name,
                inserted=inserted,
            )
            return {"inserted": inserted}
        except Exception as exc:
            return {"inserted": 0, "error": str(exc)}

    def export_backup(self) -> dict:
        import webview

        data = self._repo.export_all()
        data["exported_at"] = datetime.now().isoformat()
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        fname = f"budgetapp_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"

        if self._window:
            paths = self._window.create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename=fname,
                file_types=("JSON files (*.json)",),
            )
            if not paths:
                return {"ok": False, "cancelled": True}
            out_path = Path(paths if isinstance(paths, str) else paths[0])
        else:
            out_path = BACKUP_DIR / fname

        out_path.write_text(json.dumps(data, indent=2, default=str))
        self._save_settings({"last_backup": datetime.now().isoformat()})
        return {"ok": True, "path": str(out_path)}

    def import_backup(self) -> dict:
        import webview

        if self._window is None:
            return {"ok": False, "error": "Window not initialised"}

        paths = self._window.create_file_dialog(
            webview.OPEN_DIALOG,
            allow_multiple=False,
            file_types=("JSON files (*.json)",),
        )
        if not paths:
            return {"ok": False, "cancelled": True}

        try:
            data = json.loads(Path(paths[0]).read_text())
            counts = self._repo.import_all(data)
            return {"ok": True, "counts": counts}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    # ------------------------------------------------------------------
    # Affordability calculator
    # ------------------------------------------------------------------

    def get_budget_guide(self) -> dict:
        return self._repo.get_budget_guide()

    def get_budget_snapshot(self, months: str = "3") -> dict:
        """Return avg monthly income/spending by bucket over the last N complete months."""
        from decimal import Decimal
        from datetime import date, timedelta

        n = max(1, min(12, int(months or "3")))
        today = date.today()

        # Last N complete calendar months (exclude current in-progress month)
        first_of_current = today.replace(day=1)
        end_date = first_of_current - timedelta(days=1)
        start_date = end_date.replace(day=1)
        for _ in range(n - 1):
            start_date = (start_date - timedelta(days=1)).replace(day=1)

        conn = self._repo.conn

        # Bucket-level totals
        bucket_rows = conn.execute(
            """SELECT c.bucket, SUM(CAST(t.amount AS REAL)) AS total
               FROM transactions t
               JOIN categories c ON t.category_id = c.id
               WHERE t.date >= ? AND t.date <= ? AND c.bucket != 'transfers'
               GROUP BY c.bucket""",
            (start_date.isoformat(), end_date.isoformat()),
        ).fetchall()

        by_bucket = {r["bucket"]: Decimal(str(r["total"])) for r in bucket_rows}

        inc  = by_bucket.get("income", Decimal("0")) / n
        bill = abs(by_bucket.get("bills", Decimal("0"))) / n
        sub  = abs(by_bucket.get("subscriptions", Decimal("0"))) / n
        exp  = abs(by_bucket.get("expenses", Decimal("0"))) / n
        dbt  = abs(by_bucket.get("debts", Decimal("0"))) / n
        sav  = abs(by_bucket.get("savings", Decimal("0"))) / n
        surplus = inc - bill - sub - exp - dbt - sav

        # Category-level breakdown
        cat_rows = conn.execute(
            """SELECT t.category_id, c.name, c.bucket, c.budget_amount,
                      SUM(CAST(t.amount AS REAL)) AS total
               FROM transactions t
               JOIN categories c ON t.category_id = c.id
               WHERE t.date >= ? AND t.date <= ? AND c.bucket != 'transfers'
               GROUP BY t.category_id
               ORDER BY c.bucket, ABS(SUM(CAST(t.amount AS REAL))) DESC""",
            (start_date.isoformat(), end_date.isoformat()),
        ).fetchall()

        categories = [
            {
                "id": r["category_id"],
                "name": r["name"],
                "bucket": r["bucket"],
                "monthly_avg": float(Decimal(str(r["total"])) / n),
                "budget": float(Decimal(r["budget_amount"])) if r["budget_amount"] else None,
            }
            for r in cat_rows
        ]

        trackers = self._repo.get_savings_trackers()
        total_savings = float(sum(Decimal(t["balance"] or "0") for t in trackers))

        return {
            "monthly_income": float(inc),
            "monthly_bills": float(bill),
            "monthly_subscriptions": float(sub),
            "monthly_variable": float(exp),
            "monthly_debt_payments": float(dbt),
            "monthly_savings_contributions": float(sav),
            "monthly_surplus": float(surplus),
            "total_savings": total_savings,
            "months_analyzed": n,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "categories": categories,
        }

    def get_import_log(self, account_id: str = "") -> list[dict]:
        return self._repo.get_import_log(account_id or None)

    # ------------------------------------------------------------------
    # Categorization rules
    # ------------------------------------------------------------------

    def get_rules(self) -> list[dict]:
        return self._repo.get_rules()

    def save_rule(self, pattern: str, category_id: str) -> dict:
        return self._repo.create_rule(pattern, category_id)

    def delete_rule(self, rule_id: int) -> None:
        self._repo.delete_rule(rule_id)

    def get_settings(self) -> dict:
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        if SETTINGS_FILE.exists():
            return json.loads(SETTINGS_FILE.read_text())
        return {}

    def _save_settings(self, updates: dict) -> None:
        current = self.get_settings()
        current.update(updates)
        SETTINGS_FILE.write_text(json.dumps(current, indent=2))

    def save_setting(self, key: str, value: str) -> dict:
        try:
            self._save_settings({key: value})
            # Immediately apply recognised env-var settings
            if key == "anthropic_api_key":
                if value:
                    os.environ["ANTHROPIC_API_KEY"] = value
                else:
                    os.environ.pop("ANTHROPIC_API_KEY", None)
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    # ------------------------------------------------------------------
    # Progress / XP
    # ------------------------------------------------------------------

    _LEVELS = [
        (0,     "Getting Started"),
        (500,   "Building Momentum"),
        (1500,  "Committed"),
        (3000,  "Determined"),
        (5000,  "Unstoppable"),
        (8000,  "Warrior"),
        (12000, "Champion"),
        (20000, "Debt Slayer"),
    ]

    def get_progress(self) -> dict:
        from decimal import Decimal as _D
        xp_total = float(self._repo.get_xp_total())
        events = self._repo.get_xp_events(20)

        # Compute current level
        level_idx = 0
        for i, (threshold, _) in enumerate(self._LEVELS):
            if xp_total >= threshold:
                level_idx = i

        current_level = level_idx + 1
        current_name = self._LEVELS[level_idx][1]
        current_min = self._LEVELS[level_idx][0]
        if level_idx + 1 < len(self._LEVELS):
            next_min = self._LEVELS[level_idx + 1][0]
            next_name = self._LEVELS[level_idx + 1][1]
            xp_in_level = xp_total - current_min
            xp_needed = next_min - current_min
            pct = min(100.0, (xp_in_level / xp_needed) * 100) if xp_needed > 0 else 100.0
        else:
            next_min = None
            next_name = None
            xp_in_level = xp_total - current_min
            xp_needed = 0
            pct = 100.0

        settings = self.get_settings()
        return {
            "xp_total": xp_total,
            "level": current_level,
            "level_name": current_name,
            "level_pct": round(pct, 1),
            "xp_in_level": round(xp_in_level, 2),
            "xp_needed": xp_needed,
            "next_level_name": next_name,
            "prize_fund_balance": settings.get("prize_fund_balance", "0"),
            "prize_fund_pct": settings.get("prize_fund_pct", "10"),
            "levels": [{"level": i + 1, "name": n, "min_xp": t, "unlocked": xp_total >= t}
                       for i, (t, n) in enumerate(self._LEVELS)],
            "recent_events": events,
        }

    def set_prize_fund_pct(self, pct: str) -> None:
        self._save_settings({"prize_fund_pct": pct})

    # ------------------------------------------------------------------
    # Net worth / Assets
    # ------------------------------------------------------------------

    def get_net_worth(self) -> dict:
        return self._repo.get_net_worth()

    def save_asset(self, asset: dict) -> None:
        import re
        a_id = asset.get("id") or re.sub(r'[^a-z0-9]+', '_', asset["name"].lower()).strip('_')[:40]
        self._repo.upsert_asset(a_id, asset["name"], asset.get("value", "0"), asset.get("asset_type", "other"))

    def delete_asset(self, asset_id: str) -> None:
        self._repo.delete_asset(asset_id)

    # ------------------------------------------------------------------
    # Monthly trends
    # ------------------------------------------------------------------

    def get_monthly_trends(self, months: str = "12") -> dict:
        n = max(1, min(24, int(months or "12")))
        return self._repo.get_monthly_trends(n)

    # ------------------------------------------------------------------
    # Recurring detection
    # ------------------------------------------------------------------

    def detect_recurring(self) -> list[dict]:
        return self._repo.detect_recurring()

    # ------------------------------------------------------------------
    # Upcoming bills
    # ------------------------------------------------------------------

    def get_upcoming_bills(self) -> list[dict]:
        from datetime import date, timedelta
        today = date.today()
        debts = self._repo.get_debts()
        upcoming = []
        for d in debts:
            due_day = d.get("due_day")
            if not due_day:
                continue
            # Next occurrence of due_day in this or next month
            try:
                next_due = today.replace(day=int(due_day))
            except ValueError:
                # due_day > days in this month — use last day
                import calendar
                last = calendar.monthrange(today.year, today.month)[1]
                next_due = today.replace(day=last)
            if next_due < today:
                # Move to next month
                if today.month == 12:
                    next_due = next_due.replace(year=today.year + 1, month=1)
                else:
                    try:
                        next_due = next_due.replace(month=today.month + 1)
                    except ValueError:
                        import calendar
                        last = calendar.monthrange(today.year, today.month + 1)[1]
                        next_due = next_due.replace(month=today.month + 1, day=last)
            days_until = (next_due - today).days
            if days_until <= 14:
                upcoming.append({
                    "id": d["id"],
                    "name": d["name"],
                    "minimum": d.get("minimum"),
                    "due_date": next_due.isoformat(),
                    "days_until": days_until,
                })
        upcoming.sort(key=lambda x: x["days_until"])
        return upcoming

    # ------------------------------------------------------------------
    # Payment calendar
    # ------------------------------------------------------------------

    def get_calendar_data(self, year_month: str) -> dict:
        import calendar as cal_mod
        from datetime import date, timedelta

        year, month = map(int, year_month.split("-"))
        days_in_month = cal_mod.monthrange(year, month)[1]
        month_start = date(year, month, 1)
        month_end = date(year, month, days_in_month)

        # Actual transactions for this month
        txs = self._repo.get_transactions(month=year_month)
        tx_list = [
            _tx_dict({"id": t.id, "date": t.date, "description": t.description,
                      "amount": t.amount, "account_id": t.account_id,
                      "category_id": t.category_id, "is_manual": t.is_manual})
            for t in txs
        ]

        scheduled = []

        # Debt due dates
        debts = self._repo.get_debts()
        for d in debts:
            due_day = d.get("due_day")
            if not due_day:
                continue
            day = min(int(due_day), days_in_month)
            scheduled.append({
                "day": day,
                "label": d["name"],
                "amount": d.get("minimum"),
                "source": "debt",
            })

        # Recurring projections
        recurring = self._repo.detect_recurring()
        for r in recurring:
            try:
                last = date.fromisoformat(r["last_date"])
            except Exception:
                continue
            interval_days = max(1, int(r.get("avg_interval", 30)))

            # Fast-forward to first occurrence on or after month_start
            if last < month_start:
                delta = (month_start - last).days
                steps = delta // interval_days
                proj = last + timedelta(days=steps * interval_days)
                if proj < month_start:
                    proj += timedelta(days=interval_days)
            else:
                proj = last

            # Add all occurrences within this month
            while proj <= month_end:
                if proj >= month_start:
                    scheduled.append({
                        "day": proj.day,
                        "label": r["description"],
                        "amount": r["avg_amount"],
                        "source": "recurring",
                    })
                proj += timedelta(days=interval_days)

        return {"transactions": tx_list, "scheduled": scheduled}

    # ------------------------------------------------------------------
    # Splits
    # ------------------------------------------------------------------

    def get_splits(self, status: str = "pending") -> list[dict]:
        rows = self._repo.get_splits(status)
        # Ensure date field is a string (it comes from a JOIN as a date string already)
        for r in rows:
            if "date" in r and r["date"] and hasattr(r["date"], "isoformat"):
                r["date"] = r["date"].isoformat()
        return rows

    def create_split(self, tx_id: str, description: str, owed_by: str, amount_owed: str) -> dict:
        row = self._repo.create_split(tx_id, description, owed_by, amount_owed)
        if "date" in row and row["date"] and hasattr(row["date"], "isoformat"):
            row["date"] = row["date"].isoformat()
        return row

    def settle_split(self, split_id: str) -> None:
        self._repo.settle_split(split_id)

    def delete_split(self, split_id: str) -> None:
        self._repo.delete_split(split_id)

    # ------------------------------------------------------------------
    # Debt due day
    # ------------------------------------------------------------------

    def save_debt_due_day(self, debt_id: str, due_day) -> None:
        try:
            day = int(due_day) if due_day not in (None, "", "null") else None
        except (ValueError, TypeError):
            day = None
        self._repo.save_debt_due_day(debt_id, day)

    # ------------------------------------------------------------------
    # AI Financial Advisor
    # ------------------------------------------------------------------

    def chat_advisor(self, messages: list) -> dict:
        """Send a chat message to Claude with full financial context in the system prompt."""
        import os
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return {"error": "ANTHROPIC_API_KEY is not set. Add it to your environment to use the AI Advisor."}

        try:
            import anthropic
            from decimal import Decimal

            # ── Gather financial data ────────────────────────────────
            snapshot = self.get_budget_snapshot("3")
            debts    = self._repo.get_debts()
            cats     = self._repo.get_categories()
            rules    = self._repo.get_rules()
            trackers = self._repo.get_savings_trackers()
            net_worth = self._repo.get_net_worth()

            # ── Build system prompt ──────────────────────────────────
            lines: list[str] = [
                "You are a personal financial advisor integrated into the user's budget app.",
                "You have access to their real financial data below. Be specific, reference actual",
                "numbers, name categories and debts by their real names, and give actionable advice.",
                "Be direct and honest — if they are overspending somewhere, say so clearly.",
                "When asked about categories or rules, explain which transaction descriptions",
                "trigger each rule. Keep responses concise but complete.",
                "",
                "## Monthly Averages (last 3 months)",
                f"Income:              ${snapshot.get('monthly_income', 0):,.2f}",
                f"Bills:               ${snapshot.get('monthly_bills', 0):,.2f}",
                f"Subscriptions:       ${snapshot.get('monthly_subscriptions', 0):,.2f}",
                f"Variable Expenses:   ${snapshot.get('monthly_variable', 0):,.2f}",
                f"Debt Payments:       ${snapshot.get('monthly_debt_payments', 0):,.2f}",
                f"Savings:             ${snapshot.get('monthly_savings_contributions', 0):,.2f}",
                f"Surplus / Deficit:   ${snapshot.get('monthly_surplus', 0):+,.2f}",
                f"Total Savings:       ${snapshot.get('total_savings', 0):,.2f}",
                "",
            ]

            # Debts
            if debts:
                lines.append("## Debts")
                for d in debts:
                    parts = [f"- {d['name']}"]
                    if d.get("balance"): parts.append(f"balance ${float(d['balance']):,.2f}")
                    if d.get("apr"):     parts.append(f"{d['apr']}% APR")
                    if d.get("minimum"): parts.append(f"${float(d['minimum']):,.2f}/mo minimum")
                    lines.append("  ".join(parts))
                lines.append("")

            # Net worth
            if net_worth:
                assets   = net_worth.get("assets", [])
                accounts = net_worth.get("accounts", [])
                total_assets = sum(float(a.get("value", 0)) for a in assets)
                total_acct   = sum(float(a.get("balance", 0)) for a in accounts if a.get("balance"))
                lines.append("## Net Worth")
                lines.append(f"Total (assets + account balances): ${total_assets + total_acct:,.2f}")
                lines.append("")

            # Category budgets vs actual
            cat_rows = snapshot.get("categories", [])
            if cat_rows:
                lines.append("## Category Spending (avg/mo)")
                for c in cat_rows:
                    avg = abs(c.get("monthly_avg", 0))
                    budget = c.get("budget")
                    entry = f"- [{c['bucket']}] {c['name']}: ${avg:,.2f}/mo"
                    if budget:
                        status = "OVER" if avg > budget else "ok"
                        entry += f"  (budget ${budget:,.2f} — {status})"
                    lines.append(entry)
                lines.append("")

            # Categorization rules
            if rules:
                lines.append("## Auto-Categorization Rules (pattern → category)")
                cat_name_map = {c.id: c.name for c in cats}
                for r in rules[:30]:  # cap to avoid huge prompts
                    cat_label = cat_name_map.get(r["category_id"], r["category_id"])
                    lines.append(f"- `{r['pattern']}` → {cat_label}")
                lines.append("")

            # Savings trackers
            if trackers:
                lines.append("## Savings Trackers")
                for t in trackers:
                    bal = float(t.get("balance") or 0)
                    goal = t.get("goal_amount")
                    entry = f"- {t['name']}: ${bal:,.2f}"
                    if goal:
                        entry += f" / ${float(goal):,.2f} goal"
                    lines.append(entry)

            system_prompt = "\n".join(lines)

            # Append custom skills from data/advisor_skills.md if present
            if ADVISOR_SKILLS_FILE.exists():
                skills_text = ADVISOR_SKILLS_FILE.read_text(encoding="utf-8").strip()
                if skills_text:
                    system_prompt += f"\n\n---\n\n## Custom Advisor Instructions\n\n{skills_text}"

            # ── Call Claude ──────────────────────────────────────────
            model = self.get_settings().get("anthropic_model") or "claude-opus-4-7"
            client = anthropic.Anthropic(api_key=api_key)
            response = client.messages.create(
                model=model,
                max_tokens=1024,
                system=[{"type": "text", "text": system_prompt,
                         "cache_control": {"type": "ephemeral"}}],
                messages=messages,
            )
            return {"content": response.content[0].text}

        except Exception as exc:
            return {"error": str(exc)}

    # ------------------------------------------------------------------
    # Rule generation from transactions
    # ------------------------------------------------------------------

    def generate_rules_from_transactions(self, month: str = "") -> dict:
        import anthropic
        import json as json_mod

        api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        if not api_key:
            return {"error": "No Anthropic API key configured. Add it in Settings."}

        try:
            from datetime import date
            cats = self._repo.get_categories()
            rules = self._repo.get_rules()

            if month == "ytd":
                year_prefix = str(date.today().year)
                all_txs = [
                    t for t in self._repo.get_transactions()
                    if str(t.date).startswith(year_prefix)
                ]
            else:
                all_txs = self._repo.get_transactions(month=month or None)

            uncategorized = [t for t in all_txs if not t.category_id]

            cat_list = "\n".join(f"- {c.id}: {c.name} ({c.bucket})" for c in cats)
            rule_list = "\n".join(
                f"- pattern '{r['pattern']}' → {r['category_id']}" for r in rules[:60]
            )
            tx_lines = "\n".join(
                f"- {t.description} | ${abs(float(t.amount)):.2f}"
                for t in uncategorized[:100]
            )

            system = (
                "You are a financial categorization assistant. Analyze the uncategorized "
                "bank transactions and suggest rules to auto-categorize them.\n\n"
                "Respond ONLY with valid JSON in this exact format (no markdown, no explanation):\n"
                '{\n'
                '  "new_categories": [\n'
                '    {"name": "Category Name", "bucket": "expenses", "reason": "why"}\n'
                '  ],\n'
                '  "rules": [\n'
                '    {"pattern": "KEYWORD", "category_ref": "existing_id_or_new_name", "example": "sample tx"}\n'
                '  ]\n'
                '}\n\n'
                "Buckets: income, bills, subscriptions, expenses, savings, debts, transfers.\n"
                "Rules use case-insensitive substring matching — use the most distinctive keyword.\n"
                "Prefer existing category IDs. Only propose new categories when truly needed.\n"
                "Skip transactions already covered by existing rules."
            )

            user_msg = (
                f"Existing categories:\n{cat_list}\n\n"
                f"Existing rules:\n{rule_list or '(none)'}\n\n"
                f"Uncategorized transactions:\n{tx_lines or '(all transactions are already categorized)'}"
            )

            model = self.get_settings().get("anthropic_model") or "claude-opus-4-7"
            client = anthropic.Anthropic(api_key=api_key)
            resp = client.messages.create(
                model=model,
                max_tokens=2048,
                system=system,
                messages=[{"role": "user", "content": user_msg}],
            )
            text = resp.content[0].text.strip()

            start, end = text.find('{'), text.rfind('}') + 1
            if start == -1 or end == 0:
                return {"error": "AI did not return valid JSON."}
            data = json_mod.loads(text[start:end])

            # Resolve each rule's category reference
            cat_by_id = {c.id: c.name for c in cats}
            cat_by_name_lower = {c.name.lower(): c.id for c in cats}
            new_cat_names = {nc["name"].lower() for nc in data.get("new_categories", [])}

            rules_out = []
            for r in data.get("rules", []):
                ref = (r.get("category_ref") or "").strip()
                if ref in cat_by_id:
                    rules_out.append({
                        "pattern": r["pattern"], "category_id": ref,
                        "category_name": cat_by_id[ref],
                        "example": r.get("example", ""), "is_new_cat": False,
                    })
                elif ref.lower() in cat_by_name_lower:
                    cid = cat_by_name_lower[ref.lower()]
                    rules_out.append({
                        "pattern": r["pattern"], "category_id": cid,
                        "category_name": cat_by_id[cid],
                        "example": r.get("example", ""), "is_new_cat": False,
                    })
                elif ref.lower() in new_cat_names:
                    rules_out.append({
                        "pattern": r["pattern"], "category_id": None,
                        "category_name": ref,
                        "example": r.get("example", ""), "is_new_cat": True,
                    })

            return {
                "new_categories": data.get("new_categories", []),
                "rules": rules_out,
                "uncategorized_count": len(uncategorized),
            }

        except Exception as exc:
            return {"error": str(exc)}

    def apply_rule_suggestions(self, new_categories: list, rules: list) -> dict:
        try:
            # Create new categories first and build name → id map
            name_to_id: dict[str, str] = {}
            created_cats = 0
            for cat in new_categories:
                result = self.add_category(cat["name"], cat["bucket"], "")
                name_to_id[cat["name"].lower()] = result["id"]
                created_cats += 1

            # Refresh category lookup after creation
            all_cats = self._repo.get_categories()
            cat_by_name: dict[str, str] = {c.name.lower(): c.id for c in all_cats}
            cat_by_name.update(name_to_id)

            created_rules = 0
            for rule in rules:
                cat_id = rule.get("category_id") or cat_by_name.get(
                    (rule.get("category_name") or "").lower()
                )
                if not cat_id:
                    continue
                self.save_rule(rule["pattern"], cat_id)
                created_rules += 1

            return {"ok": True, "created_categories": created_cats, "created_rules": created_rules}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def export_rules_categories(self) -> dict:
        import webview

        cats = self._repo.get_categories()
        rules = self._repo.get_rules()
        data = {
            "exported_at": datetime.now().isoformat(),
            "categories": [
                {"id": c.id, "name": c.name, "bucket": c.bucket, "owner": c.owner,
                 "budget_amount": str(c.budget_amount) if c.budget_amount else None}
                for c in cats
            ],
            "rules": rules,
        }
        fname = f"budgetapp_rules_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"

        if self._window:
            paths = self._window.create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename=fname,
                file_types=("JSON files (*.json)",),
            )
            if not paths:
                return {"ok": False, "cancelled": True}
            out_path = Path(paths if isinstance(paths, str) else paths[0])
        else:
            BACKUP_DIR.mkdir(parents=True, exist_ok=True)
            out_path = BACKUP_DIR / fname

        out_path.write_text(json.dumps(data, indent=2, default=str))
        return {"ok": True, "path": str(out_path)}

    # ------------------------------------------------------------------
    # Advisor skills file
    # ------------------------------------------------------------------

    def get_advisor_skills(self) -> dict:
        if ADVISOR_SKILLS_FILE.exists():
            return {"content": ADVISOR_SKILLS_FILE.read_text(encoding="utf-8"), "path": str(ADVISOR_SKILLS_FILE)}
        return {"content": "", "path": str(ADVISOR_SKILLS_FILE)}

    def save_advisor_skills(self, content: str) -> dict:
        try:
            ADVISOR_SKILLS_FILE.parent.mkdir(parents=True, exist_ok=True)
            ADVISOR_SKILLS_FILE.write_text(content, encoding="utf-8")
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
