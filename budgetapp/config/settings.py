from pathlib import Path

# Root of the installed package
PACKAGE_DIR = Path(__file__).parent.parent

# Project root (one level above the package)
PROJECT_ROOT = PACKAGE_DIR.parent

# SQLite database location
DB_PATH = PROJECT_ROOT / "data" / "budgetapp.db"

# Built React frontend (served by pywebview in production)
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

APP_NAME = "BudgetApp"
APP_WIDTH = 1400
APP_HEIGHT = 900
