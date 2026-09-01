import os
import sys
from pathlib import Path

# Root of the installed package
PACKAGE_DIR = Path(__file__).parent.parent

# Project root (one level above the package) — used only in dev mode
PROJECT_ROOT = PACKAGE_DIR.parent

# ── Distributed vs. dev detection ────────────────────────────────────────
# PyInstaller sets `sys.frozen = True` on packaged binaries and copies the
# app bundle to a read-only temp dir. In that case we must NOT write inside
# the app bundle — use the OS-appropriate user data directory instead so
# the DB, backups, and settings survive app updates and app deletion.
IS_FROZEN = getattr(sys, "frozen", False)


def _user_data_dir(app: str) -> Path:
    """Platform-appropriate writable app-data location."""
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / app
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or str(Path.home())
        return Path(base) / app
    # Linux / other unix
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / app


# Demo mode — activated by `--demo` on the command line OR JADEBANKING_DEMO=1.
# When on, every file path lives under a demo/ subdir so no real data is touched.
DEMO_MODE = "--demo" in sys.argv or os.environ.get("JADEBANKING_DEMO") == "1"

if IS_FROZEN:
    # Packaged for distribution — write to ~/Library/Application Support/… etc.
    _base_data_dir = _user_data_dir("JadeBanking")
else:
    # Dev / source checkout — write inside the repo like before
    _base_data_dir = PROJECT_ROOT / "data"

_data_dir = _base_data_dir / "demo" if DEMO_MODE else _base_data_dir

# SQLite database location
DB_PATH = _data_dir / "budgetapp.db"

# Built React frontend — packaged: bundled next to the executable via
# PyInstaller's `_MEIPASS`; dev: in the repo.
if IS_FROZEN:
    FRONTEND_DIST = Path(getattr(sys, "_MEIPASS", PACKAGE_DIR)) / "frontend_dist"
else:
    FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

APP_NAME = "Jade Banking" + (" (Demo)" if DEMO_MODE else "")
APP_WIDTH = 1400
APP_HEIGHT = 900

BACKUP_DIR = _data_dir / "backups"
SETTINGS_FILE = _data_dir / "settings.json"
ADVISOR_SKILLS_FILE = _data_dir / "advisor_skills.md"

# Icon — always shipped alongside the app (bundle or repo)
if IS_FROZEN:
    APP_ICON = Path(getattr(sys, "_MEIPASS", PACKAGE_DIR)) / "icon.png"
else:
    APP_ICON = PROJECT_ROOT / "data" / "icon.png"
