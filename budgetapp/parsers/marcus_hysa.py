import re
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import pandas as pd
import pdfplumber

from .base import AbstractParser

_DATE_RE = re.compile(r'^\d{2}/\d{2}/\d{4}$')
_AMOUNT_RE = re.compile(r'^\$[\d,]+\.\d{2}$')
_SKIP_DESC = {'BeginningBalance'}  # EndingBalance handled separately to capture balance


class MarcusHYSAParser(AbstractParser):
    account_id = "marcus_hysa"

    def parse(self, pdf_path: Path) -> pd.DataFrame:
        records = []
        ending_balance: str | None = None

        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                words = page.extract_words()

                # Locate column x-positions from the header row
                credit_x = debit_x = balance_x = None
                for w in words:
                    if w['text'] == 'Credits':
                        credit_x = w['x0']
                    elif w['text'] == 'Debits' and credit_x is not None:
                        debit_x = w['x0']
                    elif w['text'] == 'Balance' and debit_x is not None:
                        balance_x = w['x0']

                if credit_x is None or debit_x is None or balance_x is None:
                    continue  # page without activity table (e.g., legal page)

                credit_debit_mid = (credit_x + debit_x) / 2
                debit_balance_mid = (debit_x + balance_x) / 2

                # Group words by line (rounded top y)
                lines: dict[float, list] = {}
                for w in words:
                    key = round(w['top'], 0)
                    lines.setdefault(key, []).append(w)

                for y in sorted(lines):
                    row = sorted(lines[y], key=lambda w: w['x0'])
                    if not row or not _DATE_RE.match(row[0]['text']):
                        continue

                    date_str = row[0]['text']
                    desc_parts, credit, debit, bal_amt = [], None, None, None

                    for w in row[1:]:
                        if _AMOUNT_RE.match(w['text']):
                            x = w['x0']
                            if x >= debit_balance_mid:
                                bal_amt = w['text']
                            elif x >= credit_debit_mid:
                                debit = w['text']
                            else:
                                credit = w['text']
                        else:
                            desc_parts.append(w['text'])

                    desc = ' '.join(desc_parts)

                    if desc == 'EndingBalance' and bal_amt:
                        ending_balance = bal_amt.replace('$', '').replace(',', '')
                        continue

                    if desc in _SKIP_DESC:
                        continue

                    if credit is not None:
                        amount = Decimal(credit.replace('$', '').replace(',', ''))
                    elif debit is not None:
                        amount = -Decimal(debit.replace('$', '').replace(',', ''))
                    else:
                        continue

                    records.append({
                        'date': datetime.strptime(date_str, '%m/%d/%Y').date(),
                        'description': desc,
                        'raw_description': desc,
                        'amount': amount,
                        'account_id': self.account_id,
                    })

        df = pd.DataFrame(records)
        if ending_balance is not None:
            df.attrs['ending_balance'] = ending_balance
        return df
