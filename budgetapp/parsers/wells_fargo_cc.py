import re
from datetime import date
from decimal import Decimal
from pathlib import Path

import pandas as pd
import pdfplumber

from .base import AbstractParser, TRANSACTION_COLUMNS, year_for_tx

# "Statement Period 03/28/2026 to 04/26/2026"
_PERIOD = re.compile(r"Statement Period \d{2}/\d{2}/\d{4} to (\d{2})/\d{2}/(\d{4})")

# Transaction line — three variants handled by one pattern:
#   Payments:   04/02 04/02 7446539FQ0XSL... ONLINE ACH PAYMENT THANK YOU 2,000.00
#   Purchases:  8735 03/27 03/28 2469216F... APPLE.COM/BILL 866-712-7753 CA 2.99
#   Interest:   04/26 04/26 INTEREST CHARGE ON PURCHASES 89.50
_TX_LINE = re.compile(
    r"^(?:\d{4}\s+)?"           # optional card-ending prefix ("8735 ")
    r"(\d{2}/\d{2})\s+"         # transaction date MM/DD  (group 1)
    r"\d{2}/\d{2}\s+"           # post date (ignored)
    r"(?:[A-Z0-9]{10,}\s+)?"    # optional reference number
    r"(.+?)\s+"                  # description              (group 2)
    r"([\d,]+\.\d{2})$"          # amount                   (group 3)
)

_CREDIT_SECTION = re.compile(r"^Payments$")
_DEBIT_SECTION = re.compile(r"^(?:Cash Advances|Purchases,|Fees Charged|Interest Charged)")


class WellsFargoCCParser(AbstractParser):
    account_id = "wells_fargo_cc"

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
            m = _PERIOD.search(line)
            if m:
                return int(m.group(2)), int(m.group(1))  # end year, end month
        raise ValueError("Could not find statement period in PDF")

    def _extract_transactions(self, lines: list[str], year: int, end_month: int) -> list[dict]:
        rows: list[dict] = []
        is_credit = False

        for line in lines:
            line = line.strip()

            if _CREDIT_SECTION.match(line):
                is_credit = True
                continue
            if _DEBIT_SECTION.match(line):
                is_credit = False
                continue

            m = _TX_LINE.match(line)
            if not m:
                continue

            date_str, desc, amount_str = m.group(1), m.group(2), m.group(3)
            month, day = int(date_str[:2]), int(date_str[3:])
            tx_date = date(year_for_tx(year, end_month, month), month, day)
            amount = Decimal(amount_str.replace(",", ""))
            if not is_credit:
                amount = -amount

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
        print("Usage: python -m budgetapp.parsers.wells_fargo_cc <statement.pdf>")
        sys.exit(1)

    parser = WellsFargoCCParser()
    df = parser.parse(Path(sys.argv[1]))
    pd.set_option("display.max_colwidth", 60)
    pd.set_option("display.width", 120)
    print(df.to_string(index=False))
