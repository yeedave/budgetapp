from abc import ABC, abstractmethod
from pathlib import Path

import pandas as pd

# Normalized columns every parser must produce.
# account_id is NOT included — the bridge assigns it from user input at import time.
TRANSACTION_COLUMNS = [
    "date",             # datetime.date
    "description",      # str — cleaned
    "raw_description",  # str — original from PDF
    "amount",           # Decimal, negative = expense, positive = income/credit
]


def year_for_tx(statement_year: int, statement_end_month: int, tx_month: int) -> int:
    """Return the correct year for a MM/DD transaction date.

    Bank statements can include transactions from the tail of the prior month.
    A January 2026 statement may contain December 2025 charges.  If the tx
    month is in Q4 (Oct–Dec) and the statement closes in Q1 (Jan–Mar) we know
    the transaction belongs to the previous year.
    """
    if tx_month >= 10 and statement_end_month <= 3:
        return statement_year - 1
    return statement_year


class AbstractParser(ABC):
    format_name: str  # subclasses declare a human-readable format label

    @abstractmethod
    def parse(self, pdf_path: Path) -> pd.DataFrame:
        """Return a DataFrame with exactly TRANSACTION_COLUMNS."""
        ...

    def validate(self, df: pd.DataFrame) -> pd.DataFrame:
        missing = set(TRANSACTION_COLUMNS) - set(df.columns)
        if missing:
            raise ValueError(f"{self.__class__.__name__} missing columns: {missing}")
        return df[TRANSACTION_COLUMNS]
