"""Combined Chase parser — auto-detects checking vs. credit card format."""
from pathlib import Path

import pandas as pd
import pdfplumber

from .base import AbstractParser
from .chase_checking import ChaseCheckingParser
from .chase_sapphire import ChaseSapphireParser


def _peek_text(pdf_path: Path, pages: int = 3) -> str:
    text = ""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages[:pages]:
            text += (page.extract_text() or "")
    return text


class ChaseParser(AbstractParser):
    """Accepts any Chase PDF — checking or credit card — and routes accordingly.

    Detection order:
      1. Presence of '*start*transaction detail' → Chase checking format
      2. Presence of 'PAYMENTS AND OTHER CREDITS' → Chase Sapphire/credit format
      3. Falls back to checking parser (raises its own error on failure)
    """

    account_id = "chase_checking"  # overridden by whichever sub-parser wins

    def parse(self, pdf_path: Path) -> pd.DataFrame:
        text = _peek_text(pdf_path)
        text_lower = text.lower()

        is_chase = (
            "chase.com" in text_lower
            or "chase card" in text_lower
            or "chase bank" in text_lower
            or "*start*transaction detail" in text_lower
            or "ultimate rewards" in text_lower
        )
        if not is_chase:
            raise ValueError("Not a Chase statement")

        if "*start*transaction detail" in text_lower:
            return ChaseCheckingParser().parse(pdf_path)
        if "PAYMENTS AND OTHER CREDITS" in text or "PURCHASE INTEREST CHARGE" in text:
            return ChaseSapphireParser().parse(pdf_path)
        return ChaseCheckingParser().parse(pdf_path)
