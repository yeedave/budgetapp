import re
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import pandas as pd
import pdfplumber

from .base import AbstractParser, TRANSACTION_COLUMNS

# Purchase/return: date  description  X%  $daily_cash  ±$amount
# e.g. "03/09/2026 TAMBULI SEAFOOD MARKET... 2% $0.76 $38.02"
_TX_PURCHASE = re.compile(
    r'^(\d{2}/\d{2}/\d{4})\s+'   # date MM/DD/YYYY
    r'(.+?)\s+'                    # description (non-greedy)
    r'\d+%\s+'                     # daily cash %
    r'\$[\d,]+\.\d{2}\s+'         # daily cash amount (ignored)
    r'(-?\$[\d,]+\.\d{2})$'       # charge amount (may be negative for returns)
)

# Payment: date  description  -$amount  (no Daily Cash column)
# e.g. "03/05/2026 ACH Deposit Internet transfer from account ending in 6772 -$1.74"
_TX_PAYMENT = re.compile(
    r'^(\d{2}/\d{2}/\d{4})\s+'   # date
    r'(.+?)\s+'                    # description
    r'(-\$[\d,]+\.\d{2})$'        # negative dollar amount
)


def _parse_date(s: str) -> date:
    return datetime.strptime(s, "%m/%d/%Y").date()


def _parse_dollar(s: str) -> Decimal:
    return Decimal(s.replace("$", "").replace(",", ""))


class AppleCardParser(AbstractParser):
    """Parser for Apple Card (Goldman Sachs) PDF statements.

    Sign logic (PDF → our convention):
      Purchases:  PDF positive  → negate → negative expense
      Payments:   PDF -$X.XX   → negate → positive credit
      Returns:    PDF -$X.XX in transactions section → negate → positive credit
    """

    format_name = "Apple Card"

    def parse(self, pdf_path: Path) -> pd.DataFrame:
        lines: list[str] = []
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                lines.extend((page.extract_text() or "").splitlines())

        rows = self._extract_transactions(lines)
        df = pd.DataFrame(rows, columns=TRANSACTION_COLUMNS)
        return self.validate(df)

    def _extract_transactions(self, lines: list[str]) -> list[dict]:
        rows: list[dict] = []

        for line in lines:
            line = line.strip()

            # Purchase or return (has Daily Cash % column)
            m = _TX_PURCHASE.match(line)
            if m:
                date_str, desc, amount_str = m.group(1), m.group(2), m.group(3)
                rows.append({
                    "date": _parse_date(date_str),
                    "description": desc.strip(),
                    "raw_description": desc.strip(),
                    "amount": -_parse_dollar(amount_str),
                })
                continue

            # Payment (no Daily Cash column, always negative in PDF)
            m = _TX_PAYMENT.match(line)
            if m:
                date_str, desc, amount_str = m.group(1), m.group(2), m.group(3)
                rows.append({
                    "date": _parse_date(date_str),
                    "description": desc.strip(),
                    "raw_description": desc.strip(),
                    "amount": -_parse_dollar(amount_str),
                })

        return rows


if __name__ == "__main__":
    import sys

    if len(sys.argv) != 2:
        print("Usage: python -m budgetapp.parsers.apple_card <statement.pdf>")
        sys.exit(1)

    parser = AppleCardParser()
    df = parser.parse(Path(sys.argv[1]))
    pd.set_option("display.max_colwidth", 60)
    pd.set_option("display.width", 120)
    print(df.to_string(index=False))
