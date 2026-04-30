from pathlib import Path

import pandas as pd

from .base import AbstractParser


class ChaseSapphireParser(AbstractParser):
    account_id = "chase_sapphire"

    def parse(self, pdf_path: Path) -> pd.DataFrame:
        # TODO: Milestone 5
        raise NotImplementedError
