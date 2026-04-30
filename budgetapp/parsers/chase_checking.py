from pathlib import Path

import pandas as pd

from .base import AbstractParser


class ChaseCheckingParser(AbstractParser):
    account_id = "chase_checking"

    def parse(self, pdf_path: Path) -> pd.DataFrame:
        # TODO: Milestone 2
        raise NotImplementedError
