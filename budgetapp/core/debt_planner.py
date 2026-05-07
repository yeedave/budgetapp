"""Debt payoff planner — Avalanche (highest APR first) and Snowball (lowest balance first)."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal


@dataclass
class Debt:
    name: str
    balance: Decimal
    apr: Decimal       # e.g. Decimal("0.2499") for 24.99%
    minimum: Decimal   # minimum monthly payment

    def __post_init__(self) -> None:
        self.balance = Decimal(str(self.balance))
        self.apr = Decimal(str(self.apr))
        self.minimum = Decimal(str(self.minimum))

    @property
    def monthly_rate(self) -> Decimal:
        return self.apr / 12


@dataclass
class MonthlySnapshot:
    month: int
    debt_name: str
    payment: Decimal
    principal: Decimal
    interest: Decimal
    balance: Decimal


@dataclass
class PayoffResult:
    strategy: Literal["avalanche", "snowball"]
    months: int
    total_paid: Decimal
    total_interest: Decimal
    payoff_order: list[str]
    schedule: list[MonthlySnapshot]

    @property
    def years_months(self) -> str:
        y, m = divmod(self.months, 12)
        if y and m:
            return f"{y}y {m}mo"
        if y:
            return f"{y}y"
        return f"{m}mo"


def _cents(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def simulate(
    debts: list[Debt],
    extra_monthly: Decimal,
    strategy: Literal["avalanche", "snowball"],
    max_months: int = 600,
) -> PayoffResult:
    """Run a month-by-month payoff simulation for the given strategy."""
    extra_monthly = Decimal(str(extra_monthly))

    # Deep-copy balances so we don't mutate caller's objects
    balances: dict[str, Decimal] = {d.name: d.balance for d in debts}
    by_name: dict[str, Debt] = {d.name: d for d in debts}

    schedule: list[MonthlySnapshot] = []
    total_paid = Decimal("0")
    total_interest = Decimal("0")
    payoff_order: list[str] = []

    for month in range(1, max_months + 1):
        active = [d for d in debts if balances[d.name] > 0]
        if not active:
            break

        # Apply interest to each active debt
        interest_charges: dict[str, Decimal] = {}
        for d in active:
            charge = _cents(balances[d.name] * d.monthly_rate)
            interest_charges[d.name] = charge
            balances[d.name] += charge

        # Pay minimums on all active debts
        payments: dict[str, Decimal] = {}
        for d in active:
            pay = min(d.minimum, balances[d.name])
            pay = _cents(pay)
            payments[d.name] = pay
            balances[d.name] -= pay
            balances[d.name] = max(Decimal("0"), balances[d.name])

        # Find newly paid-off debts after minimums
        for d in active:
            if balances[d.name] == 0 and d.name not in payoff_order:
                payoff_order.append(d.name)

        # Remaining budget after minimums
        budget_remaining = extra_monthly

        # Sort remaining active debts by priority
        still_active = [d for d in debts if balances[d.name] > 0]
        if strategy == "avalanche":
            priority = sorted(still_active, key=lambda d: d.apr, reverse=True)
        else:
            priority = sorted(still_active, key=lambda d: balances[d.name])

        for d in priority:
            if budget_remaining <= 0:
                break
            extra = min(budget_remaining, balances[d.name])
            extra = _cents(extra)
            payments[d.name] = payments.get(d.name, Decimal("0")) + extra
            balances[d.name] -= extra
            balances[d.name] = max(Decimal("0"), balances[d.name])
            budget_remaining -= extra
            if balances[d.name] == 0 and d.name not in payoff_order:
                payoff_order.append(d.name)

        # Record snapshots and totals
        for d in active:
            pmt = payments.get(d.name, Decimal("0"))
            interest = interest_charges[d.name]
            principal = pmt - interest
            total_paid += pmt
            total_interest += interest
            schedule.append(MonthlySnapshot(
                month=month,
                debt_name=d.name,
                payment=_cents(pmt),
                principal=_cents(principal),
                interest=_cents(interest),
                balance=_cents(balances[d.name]),
            ))

    months_taken = schedule[-1].month if schedule else 0
    return PayoffResult(
        strategy=strategy,
        months=months_taken,
        total_paid=_cents(total_paid),
        total_interest=_cents(total_interest),
        payoff_order=payoff_order,
        schedule=schedule,
    )


def compare(
    debts: list[Debt],
    extra_monthly: Decimal,
    max_months: int = 600,
) -> tuple[PayoffResult, PayoffResult]:
    """Return (avalanche_result, snowball_result)."""
    av = simulate(debts, extra_monthly, "avalanche", max_months)
    sn = simulate(debts, extra_monthly, "snowball", max_months)
    return av, sn


# ── CLI ──────────────────────────────────────────────────────────────────────

def _prompt_debts() -> list[Debt]:
    debts: list[Debt] = []
    print("\nEnter your debts (leave name blank when done):")
    while True:
        name = input("  Debt name (or Enter to finish): ").strip()
        if not name:
            break
        balance = Decimal(input(f"  {name} — current balance ($): ").strip())
        apr_pct = Decimal(input(f"  {name} — APR (%): ").strip())
        minimum = Decimal(input(f"  {name} — minimum monthly payment ($): ").strip())
        debts.append(Debt(name=name, balance=balance, apr=apr_pct / 100, minimum=minimum))
    return debts


def _fmt(d: Decimal) -> str:
    return f"${d:,.2f}"


def _print_result(result: PayoffResult) -> None:
    label = "AVALANCHE (highest APR first)" if result.strategy == "avalanche" else "SNOWBALL (lowest balance first)"
    print(f"\n{'─' * 52}")
    print(f"  {label}")
    print(f"{'─' * 52}")
    print(f"  Payoff time   : {result.years_months} ({result.months} months)")
    print(f"  Total paid    : {_fmt(result.total_paid)}")
    print(f"  Total interest: {_fmt(result.total_interest)}")
    print(f"  Payoff order  : {' → '.join(result.payoff_order)}")


def main() -> None:
    print("╔══════════════════════════════════════╗")
    print("║       Debt Payoff Planner            ║")
    print("╚══════════════════════════════════════╝")

    debts = _prompt_debts()
    if not debts:
        print("No debts entered — nothing to calculate.")
        return

    extra = Decimal(input("\nExtra monthly budget beyond minimums ($): ").strip())

    avalanche, snowball = compare(debts, extra)

    _print_result(avalanche)
    _print_result(snowball)

    # Recommendation
    savings = snowball.total_interest - avalanche.total_interest
    time_diff = snowball.months - avalanche.months
    print(f"\n{'═' * 52}")
    print("  RECOMMENDATION")
    print(f"{'═' * 52}")
    if savings > 0:
        print(f"  Avalanche saves {_fmt(savings)} in interest")
        if time_diff > 0:
            print(f"  and pays off {time_diff} month(s) sooner.")
        else:
            print(f"  (same payoff timeline as Snowball).")
        print("  → Choose Avalanche unless you need quick wins")
        print("    for motivation — then Snowball is fine.")
    else:
        print("  Both strategies are equivalent for your debts.")

    # Optional: show month-by-month for one strategy
    show = input("\nShow month-by-month schedule? [a]valanche / [s]nowball / [n]o: ").strip().lower()
    if show in ("a", "s"):
        result = avalanche if show == "a" else snowball
        print(f"\n{'Month':>6}  {'Debt':<22}  {'Payment':>9}  {'Interest':>9}  {'Balance':>12}")
        print("─" * 68)
        for s in result.schedule:
            print(f"{s.month:>6}  {s.debt_name:<22}  {_fmt(s.payment):>9}  {_fmt(s.interest):>9}  {_fmt(s.balance):>12}")


if __name__ == "__main__":
    main()
