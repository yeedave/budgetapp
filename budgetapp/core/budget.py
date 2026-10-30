"""50/30/20 budget strategy analysis.

Takes a BudgetSnapshot dict (as returned by Api.get_budget_snapshot) and
computes how the household's actual spending maps onto the classic
Needs / Wants / Savings-and-Payoff framework.
"""

from __future__ import annotations

from decimal import Decimal


def compute_strategy(snapshot: dict) -> dict:
    """Return a 50/30/20 analysis dict.

    Parameters
    ----------
    snapshot : dict
        Output of ``Api.get_budget_snapshot(3)`` — contains monthly averages
        for income, bills, subscriptions, variable expenses, debt payments,
        and savings contributions.

    Returns
    -------
    dict with keys:
        strategy_name, monthly_income, buckets (list of dicts with name,
        target_pct, actual_pct, actual_amount, target_amount, over).
    """
    income = Decimal(str(snapshot.get("monthly_income", 0)))
    bills = Decimal(str(snapshot.get("monthly_bills", 0)))
    subs = Decimal(str(snapshot.get("monthly_subscriptions", 0)))
    variable = Decimal(str(snapshot.get("monthly_variable", 0)))
    debt_payments = Decimal(str(snapshot.get("monthly_debt_payments", 0)))
    savings = Decimal(str(snapshot.get("monthly_savings_contributions", 0)))

    # Needs (50%): bills + subscriptions + debt minimums
    needs = bills + subs + debt_payments

    # Wants (30%): variable/discretionary expenses
    wants = variable

    # Savings & Payoff (20%): savings contributions + extra debt payments
    # (In this simplified view all savings contributions count here)
    savings_payoff = savings

    total_outflow = needs + wants + savings_payoff

    def _pct(amount: Decimal) -> float:
        if income <= 0:
            return 0.0
        return float((amount / income * 100).quantize(Decimal("0.1")))

    def _target_amount(pct: float) -> float:
        return float((income * Decimal(str(pct)) / 100).quantize(Decimal("0.01")))

    buckets = [
        {
            "name": "Needs",
            "target_pct": 50.0,
            "actual_pct": _pct(needs),
            "actual_amount": float(needs.quantize(Decimal("0.01"))),
            "target_amount": _target_amount(50.0),
            "over": _pct(needs) > 50.0,
        },
        {
            "name": "Wants",
            "target_pct": 30.0,
            "actual_pct": _pct(wants),
            "actual_amount": float(wants.quantize(Decimal("0.01"))),
            "target_amount": _target_amount(30.0),
            "over": _pct(wants) > 30.0,
        },
        {
            "name": "Savings & Payoff",
            "target_pct": 20.0,
            "actual_pct": _pct(savings_payoff),
            "actual_amount": float(savings_payoff.quantize(Decimal("0.01"))),
            "target_amount": _target_amount(20.0),
            "over": False,  # more savings is never "over"
        },
    ]

    return {
        "strategy_name": "50/30/20",
        "monthly_income": float(income.quantize(Decimal("0.01"))),
        "buckets": buckets,
    }
