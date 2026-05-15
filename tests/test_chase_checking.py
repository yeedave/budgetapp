from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from budgetapp.parsers.base import TRANSACTION_COLUMNS
from budgetapp.parsers.chase_checking import ChaseCheckingParser


@pytest.fixture
def df(chase_checking_pdf):
    return ChaseCheckingParser().parse(chase_checking_pdf)


def test_row_count(df):
    assert len(df) == 11


def test_columns(df):
    assert list(df.columns) == TRANSACTION_COLUMNS


def test_format_name(df):
    assert ChaseCheckingParser().format_name == "Chase Checking"


def test_date_range(df):
    assert df["date"].min() == date(2026, 3, 24)
    assert df["date"].max() == date(2026, 4, 15)


def test_amounts_are_decimal(df):
    assert all(isinstance(v, Decimal) for v in df["amount"])


def test_domuso_rent(df):
    row = df[df["description"].str.contains("Domuso", case=False)].iloc[0]
    assert row["amount"] == Decimal("-2492.88")
    assert row["date"] == date(2026, 4, 6)


def test_spectrum(df):
    row = df[df["description"].str.contains("Spectrum", case=False)].iloc[0]
    assert row["amount"] == Decimal("-61.25")


def test_total_deposits(df):
    deposits = df[df["amount"] > 0]["amount"].sum()
    assert deposits == Decimal("4419.87")


def test_total_withdrawals(df):
    withdrawals = df[df["amount"] < 0]["amount"].sum()
    assert withdrawals == Decimal("-4287.92")


def test_no_duplicate_date_in_description(df):
    import re
    dup_date = re.compile(r"^\d{2}/\d{2}\s+")
    for desc in df["description"]:
        assert not dup_date.match(desc), f"Duplicate date in: {desc!r}"


# --- Direct-deposit account (6772): verifies payroll rows that were fused with
#     a PDF bookmark marker and previously silently dropped. ---

@pytest.fixture
def dd_df(chase_dd_pdf):
    return ChaseCheckingParser().parse(chase_dd_pdf)


def test_dd_row_count(dd_df):
    assert len(dd_df) == 32


def test_dd_payroll_intellisense_march(dd_df):
    rows = dd_df[dd_df["description"].str.contains("Intellisense", case=False)]
    assert len(rows) == 2
    amounts = sorted(rows["amount"].tolist())
    assert amounts[0] == Decimal("1692.66")
    assert amounts[1] == Decimal("1692.67")


def test_dd_payroll_nor_la(dd_df):
    rows = dd_df[dd_df["description"].str.contains("Nor LA", case=False)]
    assert len(rows) == 2
    assert set(rows["amount"].tolist()) == {Decimal("1853.01"), Decimal("2156.73")}


def test_dd_total_deposits(dd_df):
    total = dd_df[dd_df["amount"] > 0]["amount"].sum()
    assert total == Decimal("12395.07")
