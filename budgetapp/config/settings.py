import os
import sys
from pathlib import Path

# Root of the installed package
PACKAGE_DIR = Path(__file__).parent.parent

# Project root (one level above the package)
PROJECT_ROOT = PACKAGE_DIR.parent

# Demo mode — activated by `--demo` on the command line OR JADEBANKING_DEMO=1.
# When on, every file path lives under data/demo/ so no real data is touched.
DEMO_MODE = "--demo" in sys.argv or os.environ.get("JADEBANKING_DEMO") == "1"

_data_dir = PROJECT_ROOT / "data" / ("demo" if DEMO_MODE else "")

# SQLite database location
DB_PATH = _data_dir / "budgetapp.db"

# Built React frontend (served by pywebview in production)
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

APP_NAME = "Jade Banking" + (" (Demo)" if DEMO_MODE else "")
APP_WIDTH = 1400
APP_HEIGHT = 900

BACKUP_DIR = _data_dir / "backups"
SETTINGS_FILE = _data_dir / "settings.json"
ADVISOR_SKILLS_FILE = _data_dir / "advisor_skills.md"
APP_ICON = PROJECT_ROOT / "data" / "icon.png"
