"""Wells Fargo Everyday Checking statement parser.

Format: six-column table (Date | Check # | Description | Deposits/Additions |
Withdrawals/Subtractions | Ending daily balance).  Uses pdfplumber word-level
x-positions to distinguish deposits from withdrawals — the only reliable method
since text extraction loses column alignment.
"""
import re
from datetime import date
from decimal import Decimal
from pathlib import Path

import pandas as pd
import pdfplumber

from .base import AbstractParser, TRANSACTION_COLUMNS, year_for_tx

_DATE_RE = re.compile(r'^\d{1,2}/\d{1,2}$')
_AMOUNT_RE = re.compile(r'^[\d,]+\.\d{2}$')
_YEAR_RE = re.compile(r'\b(20\d{2})\b')
# Numeric: "MM/DD/YYYY" after "through / to / -"
_PERIOD_END_NUM_RE = re.compile(r'(?:through|to|-)\s+(\d{1,2})/\d{1,2}/(\d{4})', re.IGNORECASE)
# Written month: "December 31, 2025" or "January 3 2026" after "through / to / -"
_MONTH_NAMES = {
    'january': 1, 'february': 2, 'march': 3, 'april': 4,
    'may': 5, 'june': 6, 'july': 7, 'august': 8,
    'september': 9, 'october': 10, 'november': 11, 'december': 12,
}
_PERIOD_END_NAME_RE = re.compile(
    r'(?:through|to|-)\s+(January|February|March|April|May|June|July|August'
    r'|September|October|November|December)\s+\d{1,2},?\s+(\d{4})',
    re.IGNORECASE,
)


class WellsFargoCheckingParser(AbstractParser):
    format_name = "Wells Fargo Checking"

    def parse(self, pdf_path: Path) -> pd.DataFrame:
        records = []
        year: int | None = None
        end_month: int = 6  # fallback: mid-year, no Dec→Jan correction

        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""

                if year is None:
                    # Try numeric MM/DD/YYYY period end first
                    m = _PERIOD_END_NUM_RE.search(text)
                    if m:
                        end_month = int(m.group(1))
                        year = int(m.group(2))
                    else:
                        # Try written-month format ("December 31, 2025")
                        m2 = _PERIOD_END_NAME_RE.search(text)
                        if m2:
                            end_month = _MONTH_NAMES[m2.group(1).lower()]
                            year = int(m2.group(2))
                        else:
                            # Last resort: grab any 4-digit year, capped at current year
                            # to avoid picking up future dates printed on the statement
                            for yr_match in _YEAR_RE.finditer(text):
                                candidate = int(yr_match.group(1))
                                if candidate <= date.today().year:
                                    year = candidate
                                    break

                words = page.extract_words()

                # Find column x-positions from the header row
                deposits_x = withdrawals_x = balance_x = None
                for w in words:
                    if w['text'] == 'Deposits/':
                        deposits_x = w['x0']
                    elif w['text'] == 'Withdrawals/':
                        withdrawals_x = w['x0']
                    elif w['text'] == 'balance' and withdrawals_x is not None:
                        balance_x = w['x0']

                if deposits_x is None or withdrawals_x is None:
                    continue  # no transaction table on this page

                dep_with_mid = (deposits_x + withdrawals_x) / 2
                with_bal_mid = (withdrawals_x + (balance_x or withdrawals_x + 80)) / 2

                # Group words by line (rounded y-coordinate)
                line_map: dict[float, list] = {}
                for w in words:
                    key = round(w['top'], 0)
                    line_map.setdefault(key, []).append(w)

                for y in sorted(line_map):
                    row = sorted(line_map[y], key=lambda w: w['x0'])
                    if not row or not _DATE_RE.match(row[0]['text']):
                        continue

                    if year is None:
                        continue

                    month, day = map(int, row[0]['text'].split('/'))
                    tx_date = date(year_for_tx(year, end_month, month), month, day)

                    desc_parts: list[str] = []
                    deposit_amt: str | None = None
                    withdrawal_amt: str | None = None

                    for w in row[1:]:
                        if _AMOUNT_RE.match(w['text']):
                            x = w['x0']
                            if x >= with_bal_mid:
                                pass  # ending daily balance column — skip
                            elif x >= dep_with_mid:
                                withdrawal_amt = w['text']
                            else:
                                deposit_amt = w['text']
                        else:
                            desc_parts.append(w['text'])

                    desc = ' '.join(desc_parts).strip()
                    if not desc:
                        continue

                    if deposit_amt is not None:
                        amount = Decimal(deposit_amt.replace(',', ''))
                    elif withdrawal_amt is not None:
                        amount = -Decimal(withdrawal_amt.replace(',', ''))
                    else:
                        continue

                    records.append({
                        'date': tx_date,
                        'description': desc,
                        'raw_description': desc,
                        'amount': amount,
                    })

        if not records:
            raise ValueError("No transactions found — is this a Wells Fargo Checking statement?")

        df = pd.DataFrame(records, columns=TRANSACTION_COLUMNS)
        return df


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        print("Usage: python -m budgetapp.parsers.wells_fargo_checking <statement.pdf>")
        sys.exit(1)
    parser = WellsFargoCheckingParser()
    df = parser.parse(Path(sys.argv[1]))
    pd.set_option("display.max_colwidth", 60)
    pd.set_option("display.width", 120)
    print(df.to_string(index=False))
