"""Populate the demo database with a realistic-looking but fully fictitious
dataset — safe to show friends. Every name, merchant, and amount is generated
from a fixed seed so nothing personal leaks and every run is reproducible.

Usage
-----
    python -m budgetapp.tools.seed_demo         # writes data/demo/budgetapp.db
    python -m budgetapp --demo                  # launches the app against it
"""
from __future__ import annotations

import os
import random
import shutil
import sys
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

# Force demo mode before anything else imports settings
os.environ["JADEBANKING_DEMO"] = "1"

from budgetapp.config.settings import DB_PATH, BACKUP_DIR, SETTINGS_FILE  # noqa: E402
from budgetapp.core.models import Category  # noqa: E402
from budgetapp.storage.repository import Repository  # noqa: E402

RNG = random.Random(20260731)  # fixed seed → deterministic dataset


# ── Fake accounts (mirror the real account_id conventions) ───────────────
ACCOUNTS = [
    ("primary_checking",  "Primary Checking",  "chase",       "checking", "primary"),
    ("household_checking","Household Checking","chase",       "checking", "shared"),
    ("rewards_card",      "Rewards Credit Card","chase",      "credit",   "primary"),
    ("cashback_card",     "Cashback Credit Card","wells_fargo","credit",  "primary"),
    ("emergency_savings", "Emergency Savings", "marcus",      "savings",  "shared"),
]

# ── Fake merchant catalog by category ────────────────────────────────────
# Every merchant here is a made-up name that could plausibly show up on a
# real statement. Amount tuples are (min, max) in dollars.
MERCHANTS: dict[str, list[tuple[str, tuple[float, float]]]] = {
    "exp_groceries": [
        ("FRESH MARKET DOWNTOWN",       (35, 180)),
        ("QUICKSHOP GROCERIES",         (18, 95)),
        ("SUPERSTORE #4212",            (45, 220)),
    ],
    "exp_dining": [
        ("PIER BURGER GRILL",           (14, 48)),
        ("SUNRISE CAFE",                (6, 22)),
        ("PHO BLOSSOM RESTAURANT",      (18, 65)),
        ("EVENING TAPAS BAR",           (32, 118)),
        ("COFFEE ROASTERY MAIN ST",     (5, 12)),
        ("DELUXE THAI EXPRESS",         (16, 42)),
    ],
    "exp_gas": [
        ("STARLIGHT FUEL 4402",         (28, 62)),
        ("HIGHWAY 5 GAS STATION",       (24, 58)),
    ],
    "bills_utilities": [
        ("METRO POWER & LIGHT",         (85, 145)),
        ("CITY WATER SERVICES",         (42, 78)),
    ],
    "bills_internet": [
        ("HORIZON FIBER INTERNET",      (68, 68)),
    ],
    "bills_phone": [
        ("EVERGREEN MOBILE",            (94, 94)),
    ],
    "bills_rent": [
        ("MERIDIAN APARTMENTS RENT",    (2450, 2495)),
    ],
    "sub_streaming_video": [
        ("EVERSTREAM PREMIUM",          (17.99, 17.99)),
        ("KINOWAVE MOVIE PASS",         (12.99, 12.99)),
    ],
    "sub_streaming_music": [
        ("HARMONY MUSIC UNLIMITED",     (10.99, 10.99)),
    ],
    "sub_cloud_storage": [
        ("CLOUDVAULT STORAGE",          (2.99, 2.99)),
    ],
    "sub_gym": [
        ("IRON PEAK FITNESS",           (39.99, 39.99)),
    ],
    "exp_pets": [
        ("PAWFECT PET SUPPLIES",        (28, 92)),
    ],
    "exp_medical": [
        ("MERIDIAN CLINIC COPAY",       (25, 85)),
    ],
    "exp_misc": [
        ("HANDY HARDWARE #17",          (12, 48)),
        ("EASTSIDE BOOKSHOP",           (14, 65)),
    ],
    "income_primary": [
        ("HORIZON LABS PAYROLL",        (1820, 1860)),   # bi-weekly ~$1840
    ],
    "income_partner": [
        ("MERIDIAN CLINIC PAYROLL",     (1520, 1560)),   # semi-monthly ~$1540
    ],
    "sav_hysa": [
        ("Transfer to Emergency Fund",  (500, 500)),     # $500 every month
    ],
}


def _clear_demo_dir() -> None:
    """Wipe any previous demo data (keeps things reproducible)."""
    for p in (DB_PATH, SETTINGS_FILE):
        if p.exists():
            p.unlink()
    if BACKUP_DIR.exists():
        shutil.rmtree(BACKUP_DIR, ignore_errors=True)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def _seed_accounts(repo: Repository) -> None:
    # Delete the auto-seeded accounts and replace with our demo set.
    repo.conn.execute("DELETE FROM accounts")
    repo.conn.commit()
    for i, (aid, name, bank, atype, owner) in enumerate(ACCOUNTS):
        repo.upsert_account(aid, name, bank, atype, owner)
        repo.conn.execute(
            "UPDATE accounts SET sort_order = ? WHERE id = ?", (i, aid)
        )
    repo.conn.commit()


def _seed_categories(repo: Repository) -> None:
    """Ensure a rich set of categories exist. Uses the seeded ones + a few
    extras. Sets budgets so the dashboard's budget-tracker has content."""
    budgets = {
        "bills_rent":            "2500",
        "bills_utilities":       "130",
        "bills_internet":        "68",
        "bills_phone":           "94",
        "sub_streaming_video":   "35",
        "sub_streaming_music":   "11",
        "sub_gym":               "40",
        "exp_groceries":         "600",
        "exp_dining":            "350",
        "exp_gas":               "180",
        "exp_pets":              "80",
        "exp_medical":           "150",
        "exp_misc":              "100",
    }
    for cat_id, budget in budgets.items():
        row = repo.conn.execute("SELECT id FROM categories WHERE id = ?", (cat_id,)).fetchone()
        if row:
            repo.conn.execute(
                "UPDATE categories SET budget_amount = ? WHERE id = ?", (budget, cat_id)
            )
    # A "sav_hysa" category is auto-seeded; make sure it's there.
    if not repo.conn.execute("SELECT id FROM categories WHERE id = 'sav_hysa'").fetchone():
        repo.upsert_category(Category(id="sav_hysa", name="High-Yield Savings",
                                       bucket="savings", owner="shared"))
    repo.conn.commit()


def _bill_day_for(category_id: str) -> int:
    """Deterministic day-of-month per bill so the calendar looks natural."""
    return {
        "bills_rent":          1,
        "bills_utilities":     15,
        "bills_internet":      12,
        "bills_phone":         5,
        "sub_streaming_video": 8,
        "sub_streaming_music": 22,
        "sub_cloud_storage":   3,
        "sub_gym":             27,
        "sav_hysa":            2,
    }.get(category_id, 0)


def _seed_transactions(repo: Repository) -> int:
    """Generate ~6 months of realistic-looking transactions and insert directly."""
    import pandas as pd
    from budgetapp.storage.repository import _tx_id

    today = date.today()
    start = today.replace(day=1) - timedelta(days=180)

    rows: list[tuple] = []
    count = 0

    def _add(d: date, desc: str, amount: Decimal, account_id: str, category_id: str | None):
        nonlocal count
        # seq counter avoids collisions on same-day repeats (same as prod pipeline)
        seq = 0
        tid = _tx_id(d.isoformat(), desc, str(amount), account_id, seq)
        seen_ids = {r[0] for r in rows}
        while tid in seen_ids:
            seq += 1
            tid = _tx_id(d.isoformat(), desc, str(amount), account_id, seq)
        rows.append((
            tid, d.isoformat(), desc, desc, str(amount), account_id, category_id, "dave", 0,
        ))
        count += 1

    # ── Bi-weekly paycheck (Fridays) ─────────────────────────────────────
    payday = start + timedelta(days=(4 - start.weekday()) % 7)  # first Friday on/after start
    while payday <= today:
        amt, _ = MERCHANTS["income_primary"][0][1], None
        _add(payday, MERCHANTS["income_primary"][0][0],
             Decimal(str(round(RNG.uniform(1820, 1860), 2))),
             "primary_checking", "income_primary")
        payday += timedelta(days=14)

    # ── Semi-monthly partner income (1st & 15th) ─────────────────────────
    y, m = start.year, start.month
    while date(y, m, 1) <= today:
        for d_of_m in (1, 15):
            try:
                d = date(y, m, d_of_m)
            except ValueError:
                continue
            if start <= d <= today:
                _add(d, MERCHANTS["income_partner"][0][0],
                     Decimal(str(round(RNG.uniform(1520, 1560), 2))),
                     "household_checking", "income_partner")
        m = m + 1
        if m > 12:
            m = 1
            y += 1

    # ── Monthly bills (each on its scheduled day) ────────────────────────
    monthly_bills = [
        "bills_rent", "bills_utilities", "bills_internet", "bills_phone",
        "sub_streaming_video", "sub_streaming_music", "sub_cloud_storage",
        "sub_gym", "sav_hysa",
    ]
    y, m = start.year, start.month
    while date(y, m, 1) <= today:
        for cat in monthly_bills:
            day = _bill_day_for(cat)
            if day == 0 or day > 28:
                continue
            try:
                d = date(y, m, day)
            except ValueError:
                continue
            if not (start <= d <= today):
                continue
            for name, (lo, hi) in MERCHANTS.get(cat, []):
                amt = Decimal(str(round(RNG.uniform(lo, hi), 2)))
                # sav_hysa → outflow from checking that credits the savings tracker
                if cat == "sav_hysa":
                    _add(d, name, -amt, "primary_checking", cat)
                else:
                    _add(d, name, -amt, "rewards_card", cat)
        m = m + 1
        if m > 12:
            m = 1
            y += 1

    # ── Everyday variable spending (gas, groceries, dining, pets, etc.) ──
    variable_cats = [
        ("exp_groceries", "rewards_card", 4),   # ~4x per week
        ("exp_dining",    "rewards_card", 3),
        ("exp_gas",       "cashback_card", 1),
        ("exp_pets",      "rewards_card", 1),   # per month
        ("exp_medical",   "cashback_card", 1),  # per month (sparse)
        ("exp_misc",      "cashback_card", 2),  # per week
    ]
    d = start
    while d <= today:
        for cat, account, freq_per_week in variable_cats:
            # freq_per_week can be < 1; treat as monthly if <1
            if freq_per_week < 1:
                # Monthly
                if d.day == RNG.randint(3, 26):
                    merchant, (lo, hi) = RNG.choice(MERCHANTS[cat])
                    _add(d, merchant, -Decimal(str(round(RNG.uniform(lo, hi), 2))), account, cat)
            else:
                # Weekly-ish
                if RNG.random() < freq_per_week / 7:
                    merchant, (lo, hi) = RNG.choice(MERCHANTS[cat])
                    _add(d, merchant, -Decimal(str(round(RNG.uniform(lo, hi), 2))), account, cat)
        d += timedelta(days=1)

    # ── Credit-card payments (monthly, from checking to card) ────────────
    y, m = start.year, start.month
    while date(y, m, 1) <= today:
        for card in ("rewards_card", "cashback_card"):
            try:
                d = date(y, m, 20)
            except ValueError:
                continue
            if start <= d <= today:
                pay = Decimal(str(round(RNG.uniform(180, 620), 2)))
                _add(d, f"Payment to {card.replace('_', ' ').title()}", -pay,
                     "primary_checking", "transfer_internal")
                _add(d, "Payment Thank You", pay, card, "transfer_internal")
        m = m + 1
        if m > 12:
            m = 1
            y += 1

    repo.conn.executemany(
        """INSERT OR IGNORE INTO transactions
           (id, date, description, raw_description, amount, account_id, category_id, user, is_manual)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        rows,
    )
    repo.conn.commit()
    return count


def _seed_debts_and_savings(repo: Repository) -> None:
    """Add a couple of debts and a savings tracker so the Debts tab has content."""
    repo.upsert_debt(
        id="student_loan_a",  name="Student Loan A",
        balance="14500", apr="5.5", minimum="185", months_remaining=None,
    )
    repo.upsert_debt(
        id="student_loan_b",  name="Student Loan B",
        balance="8200",  apr="4.2", minimum="120", months_remaining=None,
    )
    repo.upsert_debt(
        id="auto_loan",       name="Auto Loan",
        balance="19200", apr="6.9", minimum="425", months_remaining=None,
    )
    repo.upsert_savings_tracker(
        id="tracker_emergency", name="Emergency Fund",
        balance="4200", category_id="sav_hysa",
        goal_amount="10000", monthly_contribution="500",
    )


def main() -> None:
    print(f"Seeding demo database at: {DB_PATH}")
    _clear_demo_dir()
    repo = Repository(DB_PATH)
    _seed_accounts(repo)
    _seed_categories(repo)
    _seed_debts_and_savings(repo)
    n = _seed_transactions(repo)
    print(f"  ✓ {len(ACCOUNTS)} accounts")
    print(f"  ✓ demo debts + emergency savings tracker")
    print(f"  ✓ {n} transactions across ~6 months")
    print()
    print("Launch the app in demo mode with:")
    print("    python -m budgetapp --demo")
    print("Or set an environment variable:")
    print("    JADEBANKING_DEMO=1 python -m budgetapp")


if __name__ == "__main__":
    main()
