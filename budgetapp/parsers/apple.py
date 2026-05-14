"""Apple Card parser wrapper with bank identity check."""
from pathlib import Path

import pdfplumber

from .apple_card import AppleCardParser
from .base import AbstractParser


def _peek_text(pdf_path: Path, pages: int = 2) -> str:
    text = ""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages[:pages]:
            text += (page.extract_text() or "")
    return text


class AppleParser(AbstractParser):
    account_id = "apple_card"

    def parse(self, pdf_path: Path):
        text = _peek_text(pdf_path)
        if "apple card" not in text.lower():
            raise ValueError("Not an Apple Card statement")
        return AppleCardParser().parse(pdf_path)
