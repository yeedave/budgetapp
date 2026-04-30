from pathlib import Path
import pytest

STATEMENTS_DIR = Path(__file__).parent.parent / "bank-statements"


@pytest.fixture
def chase_checking_pdf() -> Path:
    p = STATEMENTS_DIR / "chase" / "20260421-statements-3233-.pdf"
    if not p.exists():
        pytest.skip(f"Statement not found: {p}")
    return p


@pytest.fixture
def wells_fargo_cc_pdf() -> Path:
    p = STATEMENTS_DIR / "wf" / "042626 WellsFargo.pdf"
    if not p.exists():
        pytest.skip(f"Statement not found: {p}")
    return p
