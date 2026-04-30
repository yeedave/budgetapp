# TODO: Milestone 6


class Api:
    """Exposed to the React frontend as window.pywebview.api"""

    def ping(self) -> str:
        return "pong"
