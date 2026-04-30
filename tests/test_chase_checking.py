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


def test_account_id(df):
    assert (df["account_id"] == "chase_checking").all()


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
