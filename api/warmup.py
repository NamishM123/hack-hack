"""
Vercel Python serverless function: GET/POST /api/warmup

The frontend fire-and-forgets this on page load so the Python runtime
(heavy imports + model load + Vercel runtime dependency install) is warm
before the user submits a real prediction or audit. Returns immediately.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler
from pathlib import Path

LIB = Path(__file__).resolve().parents[1] / "lib"


def _warm() -> dict:
    try:
        import joblib  # noqa: F401
        import numpy  # noqa: F401
        import pandas  # noqa: F401
        import sklearn  # noqa: F401

        joblib.load(LIB / "model.pkl")
        return {"warmed": True}
    except Exception as e:  # noqa: BLE001
        return {"warmed": False, "detail": str(e)}


class handler(BaseHTTPRequestHandler):
    def _send(self) -> None:
        body = json.dumps(_warm()).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        self._send()

    def do_POST(self) -> None:
        self._send()
