from datetime import date
from decimal import Decimal

import pytest

from budgetapp.parsers.base import TRANSACTION_COLUMNS
from budgetapp.parsers.wells_fargo_cc import WellsFargoCCParser


@pytest.fixture
def df(wells_fargo_cc_pdf):
    return WellsFargoCCParser().parse(wells_fargo_cc_pdf)


def test_row_count(df):
    assert len(df) == 21


def test_columns(df):
    assert list(df.columns) == TRANSACTION_COLUMNS


def test_account_id(df):
    assert (df["account_id"] == "wells_fargo_cc").all()


def test_date_range(df):
    assert df["date"].min() == date(2026, 3, 27)
    assert df["date"].max() == date(2026, 4, 26)


def test_amounts_are_decimal(df):
    assert all(isinstance(v, Decimal) for v in df["amount"])


def test_payments_are_positive(df):
    payments = df[df["description"].str.contains("PAYMENT THANK YOU", case=False)]
    assert len(payments) == 2
    assert (payments["amount"] > 0).all()


def test_total_payments(df):
    deposits = df[df["amount"] > 0]["amount"].sum()
    assert deposits == Decimal("2750.00")


def test_total_charges(df):
    charges = df[df["amount"] < 0]["amount"].sum()
    assert charges == Decimal("-2322.46")


def test_purchases_are_negative(df):
    costco = df[df["description"].str.contains("COSTCO", case=False)].iloc[0]
    assert costco["amount"] == Decimal("-202.31")
    assert costco["date"] == date(2026, 4, 11)


def test_cash_advance_is_negative(df):
    overdraft = df[df["description"].str.contains("OVERDRAFT", case=False)].iloc[0]
    assert overdraft["amount"] == Decimal("-1571.26")
    assert overdraft["date"] == date(2026, 3, 30)


def test_interest_charges(df):
    interest = df[df["description"].str.contains("INTEREST CHARGE", case=False)]
    assert len(interest) == 2
    assert interest["amount"].sum() == Decimal("-122.97")


def test_apple_subscription(df):
    apple = df[df["description"].str.contains("APPLE.COM", case=False)]
    assert len(apple) == 2
