from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from budgetapp.parsers.chase_checking import ChaseCheckingParser
from budgetapp.storage.repository import Repository


@pytest.fixture
def repo(tmp_path):
    return Repository(tmp_path / "test.db")


@pytest.fixture
def chase_df(chase_checking_pdf):
    return ChaseCheckingParser().parse(chase_checking_pdf)


def test_seed_accounts(repo):
    accounts = repo.get_accounts()
    ids = {a.id for a in accounts}
    assert "chase_checking" in ids
    assert "wells_fargo_cc" in ids
    assert "marcus_hysa" in ids


def test_seed_categories(repo):
    cats = repo.get_categories()
    names = {c.name for c in cats}
    assert "Casa Grande Rent" in names
    assert "Internet/Spectrum" in names
    assert "Sallie Mae" in names
    assert len(cats) >= 30


def test_seed_rules(repo):
    rules = repo.get_rules()
    patterns = {r["pattern"] for r in rules}
    assert any("DOMUSO" in p for p in patterns)
    assert any("SPECTRUM" in p for p in patterns)


def test_upsert_transactions(repo, chase_df):
    inserted = repo.upsert_transactions(chase_df)
    assert inserted == 11


def test_upsert_idempotent(repo, chase_df):
    repo.upsert_transactions(chase_df)
    second = repo.upsert_transactions(chase_df)
    assert second == 0  # no new rows


def test_get_transactions_all(repo, chase_df):
    repo.upsert_transactions(chase_df)
    txs = repo.get_transactions()
    assert len(txs) == 11


def test_get_transactions_by_account(repo, chase_df):
    repo.upsert_transactions(chase_df)
    txs = repo.get_transactions(account_id="chase_checking")
    assert len(txs) == 11
    txs_other = repo.get_transactions(account_id="wells_fargo_cc")
    assert len(txs_other) == 0


def test_get_transactions_by_month(repo, chase_df):
    repo.upsert_transactions(chase_df)
    march = repo.get_transactions(month="2026-03")
    april = repo.get_transactions(month="2026-04")
    assert len(march) == 3   # 03/24 transfer, 03/27 payment, 03/30 transfer
    assert len(april) == 8   # remaining transactions
    assert len(march) + len(april) == 11


def test_transaction_types(repo, chase_df):
    repo.upsert_transactions(chase_df)
    txs = repo.get_transactions()
    domuso = next(t for t in txs if "Domuso" in t.description)
    assert domuso.amount == Decimal("-2492.88")
    assert domuso.date == date(2026, 4, 6)
    assert domuso.account_id == "chase_checking"
    assert domuso.category_id is None


def test_set_category(repo, chase_df):
    repo.upsert_transactions(chase_df)
    txs = repo.get_transactions()
    domuso = next(t for t in txs if "Domuso" in t.description)
    repo.set_category(domuso.id, "bills_rent")
    updated = repo.get_transactions(account_id="chase_checking")
    domuso_updated = next(t for t in updated if "Domuso" in t.description)
    assert domuso_updated.category_id == "bills_rent"
