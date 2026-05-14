"""Marcus HYSA parser wrapper with bank identity check."""
from pathlib import Path

import pdfplumber

from .base import AbstractParser
from .marcus_hysa import MarcusHYSAParser


def _peek_text(pdf_path: Path, pages: int = 2) -> str:
    text = ""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages[:pages]:
            text += (page.extract_text() or "")
    return text


def _has_marcus_columns(pdf_path: Path, pages: int = 4) -> bool:
    """Check for the Credits/Debits/Balance column structure unique to Marcus statements."""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages[:pages]:
            words = [w['text'] for w in (page.extract_words() or [])]
            if 'Credits' in words and 'Debits' in words and 'Balance' in words:
                return True
    return False


class MarcusParser(AbstractParser):
    account_id = "marcus_hysa"

    def parse(self, pdf_path: Path):
        text = _peek_text(pdf_path)
        text_lower = text.lower()
        name_match = (
            "marcus" in text_lower
            or "goldman sachs" in text_lower
            or "gs bank" in text_lower
        )
        if not name_match and not _has_marcus_columns(pdf_path):
            raise ValueError("Not a Marcus / Goldman Sachs statement")
        return MarcusHYSAParser().parse(pdf_path)
