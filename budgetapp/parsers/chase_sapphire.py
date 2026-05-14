import re
from datetime import date
from decimal import Decimal
from pathlib import Path

import pandas as pd
import pdfplumber

from .base import AbstractParser, TRANSACTION_COLUMNS, year_for_tx

# "Statement Date: 04/24/26" or "Statement Date: 04/24/2026"
_STMT_DATE = re.compile(r"Statement Date:\s+(\d{2})/\d{2}/(\d{2,4})")
# Fallback: any "20XX" year in text
_YEAR_RE = re.compile(r"\b(20\d{2})\b")

_PAYMENTS_SECTION = re.compile(r"PAYMENTS AND OTHER CREDITS")
_PURCHASE_SECTION = re.compile(r"^PURCHASE$")
_INTEREST_SECTION = re.compile(r"^INTEREST CHARGED$")
# Stop collecting when we hit the totals line or year-to-date summary
_STOP = re.compile(r"^TOTAL INTEREST FOR THIS PERIOD|^\d{4} Totals Year")

# MM/DD  Description  Amount (amount may be negative for payments)
_TX_LINE = re.compile(r"^(\d{2}/\d{2})\s+(.+?)\s+(-?[\d,]+\.\d{2})$")


class ChaseSapphireParser(AbstractParser):
    account_id = "chase_sapphire"

    def parse(self, pdf_path: Path) -> pd.DataFrame:
        lines: list[str] = []
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                lines.extend((page.extract_text() or "").splitlines())

        year, end_month = self._extract_year(lines)
        rows = self._extract_transactions(lines, year, end_month)
        df = pd.DataFrame(rows, columns=TRANSACTION_COLUMNS)
        return self.validate(df)

    def _extract_year(self, lines: list[str]) -> tuple[int, int]:
        for line in lines:
            m = _STMT_DATE.search(line)
            if m:
                month = int(m.group(1))
                yr = m.group(2)
                year = int("20" + yr) if len(yr) == 2 else int(yr)
                return year, month
        for line in lines:
            m = _YEAR_RE.search(line)
            if m:
                return int(m.group(1)), 6  # fallback: mid-year, no rollback
        raise ValueError("Could not find statement period in PDF")

    def _extract_transactions(self, lines: list[str], year: int, end_month: int) -> list[dict]:
        rows: list[dict] = []
        in_activity = False

        for line in lines:
            line = line.strip()

            if _PAYMENTS_SECTION.search(line) or _PURCHASE_SECTION.match(line) or _INTEREST_SECTION.match(line):
                in_activity = True
                continue

            if _STOP.match(line):
                in_activity = False
                continue

            if not in_activity:
                continue

            m = _TX_LINE.match(line)
            if not m:
                continue

            date_str, desc, amount_str = m.group(1), m.group(2), m.group(3)
            month, day = int(date_str[:2]), int(date_str[3:])
            tx_date = date(year_for_tx(year, end_month, month), month, day)

            # PDF convention: payments negative, purchases/interest positive.
            # Our convention: income/credits positive, expenses negative.
            pdf_amount = Decimal(amount_str.replace(",", ""))
            amount = -pdf_amount

            rows.append({
                "date": tx_date,
                "description": desc.strip(),
                "raw_description": desc.strip(),
                "amount": amount,
                "account_id": self.account_id,
            })

        return rows


if __name__ == "__main__":
    import sys

    if len(sys.argv) != 2:
        print("Usage: python -m budgetapp.parsers.chase_sapphire <statement.pdf>")
        sys.exit(1)

    parser = ChaseSapphireParser()
    df = parser.parse(Path(sys.argv[1]))
    pd.set_option("display.max_colwidth", 60)
    pd.set_option("display.width", 120)
    print(df.to_string(index=False))
