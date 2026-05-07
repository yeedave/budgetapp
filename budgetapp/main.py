import sys

import webview

from budgetapp.api.bridge import Api
from budgetapp.config.settings import APP_HEIGHT, APP_NAME, APP_WIDTH, FRONTEND_DIST


def main() -> None:
    dev = "--dev" in sys.argv or not (FRONTEND_DIST / "index.html").exists()
    url = "http://localhost:5173" if dev else str(FRONTEND_DIST / "index.html")

    api = Api()
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
