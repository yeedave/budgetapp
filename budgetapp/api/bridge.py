import os
from pathlib import Path

import pandas as pd

from budgetapp.config.settings import DB_PATH
from budgetapp.core.categorizer import categorize
from budgetapp.parsers.apple_card import AppleCardParser
from budgetapp.parsers.chase_checking import ChaseCheckingParser
from budgetapp.parsers.marcus_hysa import MarcusHYSAParser
from budgetapp.parsers.wells_fargo_cc import WellsFargoCCParser
from budgetapp.storage.repository import Repository

_PARSERS = {
    "apple_card": AppleCardParser,
    "chase_checking": ChaseCheckingParser,
    "marcus_hysa": MarcusHYSAParser,
    "wells_fargo_cc": WellsFargoCCParser,
}


def _tx_dict(row) -> dict:
    return {
        "id": row["id"],
        "date": row["date"].isoformat(),
        "description": row["description"],
        "amount": str(row["amount"]),
        "account_id": row["account_id"],
        "category_id": row["category_id"],
    }


class Api:
    """Exposed to the React frontend as window.pywebview.api."""

    def __init__(self) -> None:
        self._repo = Repository(DB_PATH)
        self._window = None  # injected after webview.create_window

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
                 "account_type": a.account_type, "owner": a.owner}
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
                          "category_id": t.category_id})
                for t in txs]

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def set_category(self, tx_id: str, category_id: str) -> None:
        self._repo.set_category(tx_id, category_id)

    def get_importable_accounts(self) -> list[dict]:
        """Accounts that have a registered parser."""
        accounts = self._repo.get_accounts()
        return [{"id": a.id, "name": a.name}
                for a in accounts if a.id in _PARSERS]

    def add_account(self, name: str, bank: str, account_type: str, owner: str) -> dict:
        import re
        slug = re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')[:40]
        self._repo.upsert_account(slug, name, bank, account_type, owner)
        return {"id": slug, "name": name, "bank": bank,
                "account_type": account_type, "owner": owner}

    def update_account(self, id: str, name: str, bank: str, account_type: str, owner: str) -> None:
        self._repo.upsert_account(id, name, bank, account_type, owner)

    def delete_account(self, account_id: str) -> dict:
        try:
            self._repo.delete_account(account_id)
            return {"ok": True}
        except ValueError as exc:
            return {"ok": False, "error": str(exc)}

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
        )

    def delete_savings_tracker(self, tracker_id: str) -> None:
        self._repo.delete_savings_tracker(tracker_id)

    def get_debts(self) -> list[dict]:
        return self._repo.get_debts()

    def save_debt(self, debt: dict) -> None:
        mr = debt.get("months_remaining")
        try:
            months_remaining = int(mr) if mr not in (None, "", "null") else None
        except (ValueError, TypeError):
            months_remaining = None
        self._repo.upsert_debt(
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

    def import_statement(self, account_id: str) -> dict:
        import webview

        parser_cls = _PARSERS.get(account_id)
        if parser_cls is None:
            return {"inserted": 0, "error": f"No parser implemented for: {account_id}"}

        if self._window is None:
            return {"inserted": 0, "error": "Window not initialised"}

        paths = self._window.create_file_dialog(
            webview.OPEN_DIALOG,
            allow_multiple=False,
            file_types=("PDF files (*.pdf)",),
        )
        if not paths:
            return {"inserted": 0, "cancelled": True}

        try:
            df = parser_cls().parse(Path(paths[0]))
            df = categorize(df, self._repo,
                            use_ai=bool(os.environ.get("ANTHROPIC_API_KEY")))
            inserted = self._repo.upsert_transactions(df)

            # If the parser detected an ending balance, update the savings tracker
            # whose id starts with tracker_<bank> (e.g. tracker_marcus for marcus_hysa).
            ending_balance = df.attrs.get('ending_balance')
            if ending_balance:
                bank = account_id.split('_')[0]          # "marcus" from "marcus_hysa"
                tracker_id = f'tracker_{bank}'           # "tracker_marcus"
                trackers = self._repo.get_savings_trackers()
                linked = next((t for t in trackers if t['id'] == tracker_id), None)
                if linked:
                    self._repo.upsert_savings_tracker(
                        linked['id'], linked['name'], ending_balance,
                        linked.get('category_id'),
                    )

            return {"inserted": inserted}
        except Exception as exc:
            return {"inserted": 0, "error": str(exc)}
