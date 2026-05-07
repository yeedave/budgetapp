from decimal import Decimal
import pytest
from budgetapp.core.debt_planner import Debt, simulate, compare, PayoffResult


def make_debts():
    return [
        Debt("Card A", balance="1000", apr="0.20", minimum="25"),
        Debt("Card B", balance="500",  apr="0.30", minimum="15"),
        Debt("Loan",   balance="3000", apr="0.08", minimum="60"),
    ]


def test_single_debt_pays_off():
    debts = [Debt("Card", balance="1000", apr="0.12", minimum="50")]
    result = simulate(debts, extra_monthly=Decimal("50"), strategy="avalanche")
    assert result.months > 0
    assert result.months < 600
    assert result.total_interest > 0
    assert result.payoff_order == ["Card"]


def test_avalanche_order():
    """Highest APR debt (Card B at 30%) should be paid off first."""
    debts = make_debts()
    result = simulate(debts, extra_monthly=Decimal("100"), strategy="avalanche")
    assert result.payoff_order[0] == "Card B"


def test_snowball_order():
    """Lowest balance debt (Card B at $500) should be paid off first."""
    debts = make_debts()
    result = simulate(debts, extra_monthly=Decimal("100"), strategy="snowball")
    assert result.payoff_order[0] == "Card B"


def test_avalanche_saves_interest():
    """Avalanche should pay less total interest than Snowball (or equal)."""
    debts = [
        Debt("High APR", balance="2000", apr="0.25", minimum="50"),
        Debt("Low APR",  balance="500",  apr="0.05", minimum="20"),
    ]
    av, sn = compare(debts, extra_monthly=Decimal("200"))
    assert av.total_interest <= sn.total_interest


def test_zero_extra_budget():
    """With no extra budget, debts still pay off on minimums."""
    debts = [Debt("Loan", balance="500", apr="0.10", minimum="100")]
    result = simulate(debts, extra_monthly=Decimal("0"), strategy="avalanche")
    assert result.months > 0
    assert result.payoff_order == ["Loan"]


def test_total_paid_equals_balance_plus_interest():
    debts = [Debt("Card", balance="1000", apr="0.18", minimum="40")]
    result = simulate(debts, extra_monthly=Decimal("60"), strategy="avalanche")
    # total paid = original balance + total interest (within rounding tolerance)
    diff = abs(result.total_paid - (Decimal("1000") + result.total_interest))
    assert diff < Decimal("1.00")


def test_all_debts_paid_off():
    debts = make_debts()
    for strategy in ("avalanche", "snowball"):
        result = simulate(debts, extra_monthly=Decimal("200"), strategy=strategy)
        assert len(result.payoff_order) == len(debts)


def test_compare_returns_both_strategies():
    debts = make_debts()
    av, sn = compare(debts, extra_monthly=Decimal("150"))
    assert av.strategy == "avalanche"
    assert sn.strategy == "snowball"


def test_years_months_format():
    debts = [Debt("Big Loan", balance="10000", apr="0.05", minimum="100")]
    result = simulate(debts, extra_monthly=Decimal("0"), strategy="avalanche")
    fmt = result.years_months
    assert "y" in fmt or "mo" in fmt


def test_schedule_balances_reach_zero():
    debts = [
        Debt("Card A", balance="800",  apr="0.22", minimum="30"),
        Debt("Card B", balance="1200", apr="0.18", minimum="40"),
    ]
    result = simulate(debts, extra_monthly=Decimal("100"), strategy="avalanche")
    for debt in debts:
        final = [s for s in result.schedule if s.debt_name == debt.name]
        assert final[-1].balance == Decimal("0.00")
