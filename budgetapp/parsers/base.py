from abc import ABC, abstractmethod
from pathlib import Path

import pandas as pd

# Normalized columns every parser must produce
TRANSACTION_COLUMNS = [
    "date",         # datetime.date
    "description",  # str — cleaned
    "raw_description",  # str — original from PDF
    "amount",       # Decimal, negative = expense, positive = income/credit
    "account_id",   # str — matches accounts table
]


class AbstractParser(ABC):
    account_id: str  # subclasses declare this

    @abstractmethod
    def parse(self, pdf_path: Path) -> pd.DataFrame:
        """Return a DataFrame with exactly TRANSACTION_COLUMNS."""
        ...

    def validate(self, df: pd.DataFrame) -> pd.DataFrame:
        missing = set(TRANSACTION_COLUMNS) - set(df.columns)
        if missing:
            raise ValueError(f"{self.__class__.__name__} missing columns: {missing}")
        return df[TRANSACTION_COLUMNS]
