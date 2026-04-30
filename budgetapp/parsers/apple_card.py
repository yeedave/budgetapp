from pathlib import Path

import pandas as pd

from .base import AbstractParser


class AppleCardParser(AbstractParser):
    account_id = "apple_card"

    def parse(self, pdf_path: Path) -> pd.DataFrame:
        # TODO: Milestone 5
        raise NotImplementedError
