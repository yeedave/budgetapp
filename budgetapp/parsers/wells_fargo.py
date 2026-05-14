"""Combined Wells Fargo parser — auto-detects statement format."""
from pathlib import Path

import pdfplumber

from .base import AbstractParser
from .wells_fargo_cc import WellsFargoCCParser
from .wells_fargo_checking import WellsFargoCheckingParser


def _peek_text(pdf_path: Path, pages: int = 3) -> str:
    text = ""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages[:pages]:
            text += (page.extract_text() or "")
    return text


class WellsFargoParser(AbstractParser):
    """Accepts any Wells Fargo PDF and routes to CC or Checking sub-parser."""

    account_id = "wells_fargo_cc"  # overridden per sub-parser

    def parse(self, pdf_path: Path):
        text = _peek_text(pdf_path)
        text_lower = text.lower()
        if "wells fargo" not in text_lower and "wellsfargo" not in text_lower:
            raise ValueError("Not a Wells Fargo statement")

        # Checking statements contain "Deposits/Additions" table header
        if "deposits/" in text_lower or "everyday checking" in text_lower or "way2save" in text_lower:
            return WellsFargoCheckingParser().parse(pdf_path)

        # CC statements contain "Statement Period" header
        return WellsFargoCCParser().parse(pdf_path)
