from pathlib import Path

import pandas as pd

from .base import AbstractParser


class MarcusHYSAParser(AbstractParser):
    account_id = "marcus_hysa"

    def parse(self, pdf_path: Path) -> pd.DataFrame:
        # TODO: Milestone 5
        raise NotImplementedError
