from pathlib import Path

import pandas as pd

from .base import AbstractParser


class ChaseSapphireParser(AbstractParser):
    """Parser for Chase Sapphire credit card PDF statements.

    Expected format: same structure as Chase checking — transaction detail
    block delimited by *start*transaction detail / *end*transaction detail,
    with lines: MM/DD  <description>  <amount>  <running balance>
    """

    account_id = "chase_sapphire"

    def parse(self, pdf_path: Path) -> pd.DataFrame:
        raise NotImplementedError("Add a Chase Sapphire PDF to implement and test")
