import json
import sys
from datetime import datetime

import webview

from budgetapp.api.bridge import Api
from budgetapp.config.settings import APP_HEIGHT, APP_NAME, APP_WIDTH, BACKUP_DIR, FRONTEND_DIST


def _maybe_auto_backup(api: Api) -> None:
    settings = api.get_settings()
    last = settings.get("last_backup", "")
    this_month = datetime.now().strftime("%Y-%m")
    if last[:7] == this_month:
        return
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    fname = f"budgetapp_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    data = api._repo.export_all()
    data["exported_at"] = datetime.now().isoformat()
    (BACKUP_DIR / fname).write_text(json.dumps(data, indent=2, default=str))
    api._save_settings({"last_backup": datetime.now().isoformat()})


def main() -> None:
    dev = "--dev" in sys.argv or not (FRONTEND_DIST / "index.html").exists()
    url = "http://localhost:5173" if dev else str(FRONTEND_DIST / "index.html")

    api = Api()
    _maybe_auto_backup(api)
    window = webview.create_window(
        APP_NAME,
        url,
        js_api=api,
        width=APP_WIDTH,
        height=APP_HEIGHT,
        min_size=(900, 600),
    )
    api.set_window(window)
    webview.start(debug=dev)


if __name__ == "__main__":
    main()
