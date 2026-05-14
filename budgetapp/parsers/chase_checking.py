import re
from datetime import date
from decimal import Decimal
from pathlib import Path

import pandas as pd
import pdfplumber

from .base import AbstractParser, TRANSACTION_COLUMNS, year_for_tx

# Matches: 03/24  <description>  1,200.00  2,873.24
#      or: 03/27  -373.00  2,500.24
_TX_LINE = re.compile(
    r"^(\d{2}/\d{2})\s+(.+?)\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})$"
)
# Statement period header: "March 21, 2026throughApril 21, 2026"
_PERIOD = re.compile(r"(\w+ \d+, \d{4})through(\w+ \d+, \d{4})")
# Duplicate date prefix on some descriptions e.g. "03/27 Payment To Chase Card..."
_DUP_DATE = re.compile(r"^\d{2}/\d{2}\s+")


def _parse_amount(s: str) -> Decimal:
    return Decimal(s.replace(",", ""))


class ChaseCheckingParser(AbstractParser):
    account_id = "chase_checking"

    def parse(self, pdf_path: Path) -> pd.DataFrame:
        full_text = ""
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                full_text += (page.extract_text() or "") + "\n"

        year, end_month = self._extract_year(full_text)
        rows = self._extract_transactions(full_text, year, end_month)
        df = pd.DataFrame(rows, columns=TRANSACTION_COLUMNS)
        return self.validate(df)

    def _extract_year(self, text: str) -> tuple[int, int]:
        m = _PERIOD.search(text)
        if not m:
            raise ValueError("Could not find statement period in PDF")
        from datetime import datetime
        end_date = datetime.strptime(m.group(2).strip(), "%B %d, %Y")
        return end_date.year, end_date.month

    def _extract_transactions(self, text: str, year: int, end_month: int) -> list[dict]:
        # Pull out only the transaction detail block
        block_match = re.search(
            r"\*start\*transaction detail(.+?)\*end\*transaction detail",
            text,
            re.DOTALL,
        )
        if not block_match:
            raise ValueError("Could not find transaction detail block in PDF")

        rows = []
        for line in block_match.group(1).splitlines():
            line = line.strip()
            m = _TX_LINE.match(line)
            if not m:
                continue

            raw_date, raw_desc, raw_amount, _ = m.groups()
            # Skip summary rows like "Beginning Balance" / "Ending Balance"
            if not re.match(r"\d{2}/\d{2}", raw_date):
                continue

            month, day = int(raw_date[:2]), int(raw_date[3:])
            tx_date = date(year_for_tx(year, end_month, month), month, day)

            raw_desc = raw_desc.strip()
            clean_desc = _DUP_DATE.sub("", raw_desc).strip()
            amount = _parse_amount(raw_amount)

            rows.append({
                "date": tx_date,
                "description": clean_desc,
                "raw_description": raw_desc,
                "amount": amount,
                "account_id": self.account_id,
            })

        return rows


if __name__ == "__main__":
    import sys

    if len(sys.argv) != 2:
        print("Usage: python -m budgetapp.parsers.chase_checking <statement.pdf>")
        sys.exit(1)

    parser = ChaseCheckingParser()
    df = parser.parse(Path(sys.argv[1]))
    pd.set_option("display.max_colwidth", 60)
    pd.set_option("display.width", 120)
    print(df.to_string(index=False))
