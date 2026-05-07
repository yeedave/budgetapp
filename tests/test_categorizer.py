import os
from decimal import Decimal

import pandas as pd
import pytest

from budgetapp.core.categorizer import _apply_rules, categorize
from budgetapp.parsers.chase_checking import ChaseCheckingParser
from budgetapp.storage.repository import Repository


@pytest.fixture
def repo(tmp_path):
    return Repository(tmp_path / "test.db")


@pytest.fixture
def chase_df(chase_checking_pdf):
    return ChaseCheckingParser().parse(chase_checking_pdf)


# ------------------------------------------------------------------
# Unit tests for the regex rule engine (no DB, no AI)
# ------------------------------------------------------------------

_MOCK_RULES = [
    {"pattern": r"DOMUSO", "category_id": "bills_rent", "priority": 10},
    {"pattern": r"SPECTRUM", "category_id": "bills_internet", "priority": 10},
    {"pattern": r"SALLIE MAE", "category_id": "debt_sallie_mae", "priority": 10},
    {"pattern": r"NETFLIX", "category_id": "sub_netflix", "priority": 5},
]


def test_rule_match_domuso():
    assert _apply_rules("Domuso Rent Payment", _MOCK_RULES) == "bills_rent"


def test_rule_match_case_insensitive():
    assert _apply_rules("spectrum internet", _MOCK_RULES) == "bills_internet"


def test_rule_no_match():
    assert _apply_rules("STARBUCKS COFFEE", _MOCK_RULES) is None


def test_rule_first_match_wins():
    # DOMUSO has higher priority and is listed first; should match DOMUSO rule
    assert _apply_rules("DOMUSO domuso", _MOCK_RULES) == "bills_rent"


# ------------------------------------------------------------------
# Integration: categorize() with real DB rules, no AI
# ------------------------------------------------------------------

def test_categorize_known_rules(repo, chase_df):
    result = categorize(chase_df, repo, use_ai=False)
    domuso = result[result["description"].str.contains("Domuso", case=False)].iloc[0]
    assert domuso["category_id"] == "bills_rent"


def test_categorize_spectrum(repo, chase_df):
    result = categorize(chase_df, repo, use_ai=False)
    spectrum = result[result["description"].str.contains("Spectrum", case=False)].iloc[0]
    assert spectrum["category_id"] == "bills_internet"


def test_categorize_returns_copy(repo, chase_df):
    original_cols = list(chase_df.columns)
    result = categorize(chase_df, repo, use_ai=False)
    assert list(chase_df.columns) == original_cols  # original unchanged
    assert "category_id" in result.columns


def test_categorize_no_ai_leaves_unknowns_none(repo, chase_df):
    result = categorize(chase_df, repo, use_ai=False)
    # Unmatched rows are NaN (pandas converts None → NaN in object columns)
    for val in result["category_id"]:
        assert pd.isna(val) or isinstance(val, str)


# ------------------------------------------------------------------
# AI fallback — only runs when ANTHROPIC_API_KEY is set
# ------------------------------------------------------------------

@pytest.mark.skipif(
    not os.environ.get("ANTHROPIC_API_KEY"),
    reason="ANTHROPIC_API_KEY not set",
)
def test_categorize_with_ai_fills_more(repo, chase_df):
    no_ai = categorize(chase_df, repo, use_ai=False)
    with_ai = categorize(chase_df, repo, use_ai=True)
    matched_no_ai = no_ai["category_id"].notna().sum()
    matched_with_ai = with_ai["category_id"].notna().sum()
    assert matched_with_ai >= matched_no_ai
