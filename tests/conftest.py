from pathlib import Path
import pytest

STATEMENTS_DIR = Path(__file__).parent.parent / "bank-statements"


@pytest.fixture
def chase_bills_pdf() -> Path:
    p = STATEMENTS_DIR / "chase" / "bills" / "20260421-statements-3233-.pdf"
    if not p.exists():
        pytest.skip(f"Statement not found: {p}")
    return p


# Keep the old name as an alias so any other tests using it still work.
@pytest.fixture
def chase_checking_pdf(chase_bills_pdf) -> Path:
    return chase_bills_pdf


@pytest.fixture
def chase_dd_pdf() -> Path:
    """Direct-deposit account (account ending 6772) — has bold payroll entries."""
    p = STATEMENTS_DIR / "chase" / "direct deposit" / "20260416-statements-6772-.pdf"
    if not p.exists():
        pytest.skip(f"Statement not found: {p}")
    return p


@pytest.fixture
def wells_fargo_cc_pdf() -> Path:
    p = STATEMENTS_DIR / "wf" / "credit" / "042626 WellsFargo.pdf"
    if not p.exists():
        pytest.skip(f"Statement not found: {p}")
    return p
