import re
from datetime import date
from decimal import Decimal
from pathlib import Path

import pandas as pd
import pdfplumber

from .base import AbstractParser, TRANSACTION_COLUMNS, year_for_tx

# Normal row: 03/24  <desc>  -1,200.00  2,873.24  (amount + running balance)
_TX_LINE = re.compile(
    r"^(\d{1,2}/\d{2})\s+(.+?)\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})$"
)
# Safety net: if a bold income amount is extracted out-of-column by pdfplumber,
# the transaction line carries only the running balance.
_TX_LINE_BALANCE_ONLY = re.compile(
    r"^(\d{1,2}/\d{2})\s+(.+?)\s+(-?[\d,]+\.\d{2})$"
)
# Statement period header: "March 18, 2026throughApril 16, 2026"
_PERIOD = re.compile(r"(\w+ \d+, \d{4})through(\w+ \d+, \d{4})")
# Beginning balance line in header area
_BEGIN_BALANCE = re.compile(r"Beginning Balance\s+\$?([\d,]+\.\d{2})")
# Duplicate date prefix on some descriptions e.g. "03/27 Payment To Chase Card..."
_DUP_DATE = re.compile(r"^\d{1,2}/\d{2}\s+")


def _parse_amount(s: str) -> Decimal:
    return Decimal(s.replace(",", ""))


class ChaseCheckingParser(AbstractParser):
    format_name = "Chase Checking"

    def parse(self, pdf_path: Path) -> pd.DataFrame:
        full_text = ""
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                full_text += (page.extract_text() or "") + "\n"

        year, end_month = self._extract_year(full_text)
        begin_balance = self._extract_begin_balance(full_text)
        rows = self._extract_transactions(full_text, year, end_month, begin_balance)
        df = pd.DataFrame(rows, columns=TRANSACTION_COLUMNS)
        return self.validate(df)

    def _extract_year(self, text: str) -> tuple[int, int]:
        m = _PERIOD.search(text)
        if not m:
            raise ValueError("Could not find statement period in PDF")
        from datetime import datetime
        end_date = datetime.strptime(m.group(2).strip(), "%B %d, %Y")
        return end_date.year, end_date.month

    def _extract_begin_balance(self, text: str) -> Decimal | None:
        m = _BEGIN_BALANCE.search(text)
        return _parse_amount(m.group(1)) if m else None

    def _extract_transactions(
        self, text: str, year: int, end_month: int, begin_balance: Decimal | None
    ) -> list[dict]:
        block_match = re.search(
            r"\*start\*transaction detail(.+?)\*end\*transaction detail",
            text,
            re.DOTALL,
        )
        if not block_match:
            raise ValueError("Could not find transaction detail block in PDF")

        source = block_match.group(1)
        # Fallback: if markers exist but delimit nothing, scan full text.
        if not source.strip():
            source = text

        rows: list[dict] = []
        prev_balance: Decimal | None = begin_balance

        for line in source.splitlines():
            line = line.strip()
            if not line:
                continue
            # PDF bookmark markers are rendered as text and may fuse with the
            # adjacent transaction line (e.g. "*end*transac0tion detail4/07 …").
            # When a line starts with a marker, seek to the first date-like
            # token rather than trying to strip the corrupted marker text.
            if line.startswith('*'):
                dm = re.search(r'\d{1,2}/\d{2}', line)
                if dm:
                    line = line[dm.start():]
                else:
                    continue  # pure marker with no fused transaction

            # Normal case: both amount and running balance present.
            m = _TX_LINE.match(line)
            if m:
                raw_date, raw_desc, raw_amount, raw_balance = m.groups()
                month, day = int(raw_date.split('/')[0]), int(raw_date.split('/')[1])
                tx_date = date(year_for_tx(year, end_month, month), month, day)
                clean_desc = _DUP_DATE.sub("", raw_desc.strip()).strip()
                amount = _parse_amount(raw_amount)
                prev_balance = _parse_amount(raw_balance)
                rows.append({
                    "date": tx_date,
                    "description": clean_desc,
                    "raw_description": raw_desc,
                    "amount": amount,
                })
                continue

            # Income case: bold deposit amount was extracted out-of-column by
            # pdfplumber, so only the running balance appears on this line.
            # Derive the transaction amount from the balance delta.
            m = _TX_LINE_BALANCE_ONLY.match(line)
            if m:
                raw_date, raw_desc, raw_balance = m.groups()
                # Guard against "Beginning Balance" / "Ending Balance" rows.
                if "Balance" in raw_desc:
                    continue
                month, day = int(raw_date.split('/')[0]), int(raw_date.split('/')[1])
                tx_date = date(year_for_tx(year, end_month, month), month, day)
                clean_desc = _DUP_DATE.sub("", raw_desc.strip()).strip()
                balance = _parse_amount(raw_balance)
                amount = balance - prev_balance if prev_balance is not None else balance
                prev_balance = balance
                rows.append({
                    "date": tx_date,
                    "description": clean_desc,
                    "raw_description": raw_desc,
                    "amount": amount,
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
