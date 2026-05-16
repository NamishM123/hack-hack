"""
Vercel Python serverless function: POST /api/predict

Body (JSON): the 8 ApplicantInput fields (see lib/feature_names.json).
Returns the PredictionResult shape from lib/types.ts:
  { decision, probability, confidence, top_factors[], explanation, is_mock:false }

SHAP: exact per-feature contributions via shap.LinearExplainer on the
LogisticRegression, aggregated from the one-hot/scaled space back to the
8 original fields.
"""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler
from pathlib import Path

LIB = Path(__file__).resolve().parents[1] / "lib"

LABELS = {
    "annual_income": "Annual income",
    "loan_amount": "Loan amount",
    "loan_duration_months": "Loan duration",
    "age": "Age",
    "credit_history": "Credit history",
    "employment_length": "Employment length",
    "housing": "Housing",
    "purpose": "Loan purpose",
}

_state: dict = {}


def _ensure_loaded() -> dict:
    """Cold-start init, cached for warm invocations."""
    if _state:
        return _state

    import joblib
    import numpy as np
    import pandas as pd
    import shap

    contract = json.loads((LIB / "feature_names.json").read_text())
    model = joblib.load(LIB / "model.pkl")
    pre = model.named_steps["pre"]
    clf = model.named_steps["clf"]

    sample = pd.read_csv(LIB / "sample_data.csv")
    order = contract["feature_order"]
    bg = pre.transform(sample[order].head(100))
    bg = bg.toarray() if hasattr(bg, "toarray") else np.asarray(bg)
    explainer = shap.LinearExplainer(clf, bg)

    # transformed-column -> original-feature map for SHAP aggregation
    out_names = list(pre.get_feature_names_out())
    col_to_feat: list[str] = []
    for name in out_names:
        body = name.split("__", 1)[1] if "__" in name else name
        match = None
        for feat in order:
            if body == feat or body.startswith(feat + "_"):
                match = feat
                break
        col_to_feat.append(match or body)

    _state.update(
        contract=contract,
        model=model,
        pre=pre,
        clf=clf,
        explainer=explainer,
        col_to_feat=col_to_feat,
        order=order,
        np=np,
        pd=pd,
    )
    return _state


def _validate(payload: dict, contract: dict) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object.")
    numeric = contract["numeric_features"]
    categorical = contract["categorical_features"]
    opts = contract["categorical_options"]
    clean: dict = {}

    for f in numeric:
        if f not in payload:
            raise ValueError(f"Missing required field: {f}")
        try:
            v = float(payload[f])
        except (TypeError, ValueError):
            raise ValueError(f"Field '{f}' must be a number.")
        if v < 0:
            raise ValueError(f"Field '{f}' must be non-negative.")
        clean[f] = v

    for f in categorical:
        if f not in payload:
            raise ValueError(f"Missing required field: {f}")
        val = str(payload[f])
        if val not in opts[f]:
            raise ValueError(
                f"Field '{f}' must be one of {opts[f]}; got '{val}'."
            )
        clean[f] = val
    return clean


def run_prediction(payload: dict) -> dict:
    """Pure core — also used by the local test harness."""
    st = _ensure_loaded()
    np, pd = st["np"], st["pd"]
    clean = _validate(payload, st["contract"])

    row = pd.DataFrame([{k: clean[k] for k in st["order"]}])
    Xt = st["pre"].transform(row)
    Xt = Xt.toarray() if hasattr(Xt, "toarray") else np.asarray(Xt)

    proba = float(st["clf"].predict_proba(Xt)[0, 1])
    decision = "approved" if proba >= 0.5 else "denied"

    sv = st["explainer"].shap_values(Xt)
    sv = np.asarray(sv)
    if sv.ndim == 3:  # (classes, n, feat) in some shap versions
        sv = sv[-1]
    shap_row = sv[0]

    agg: dict[str, float] = {}
    for col_i, feat in enumerate(st["col_to_feat"]):
        agg[feat] = agg.get(feat, 0.0) + float(shap_row[col_i])

    factors = sorted(
        (
            {
                "feature": f,
                "label": LABELS.get(f, f),
                "value": round(v, 4),
                "direction": "increases" if v >= 0 else "decreases",
            }
            for f, v in agg.items()
        ),
        key=lambda d: abs(d["value"]),
        reverse=True,
    )[:5]

    top = factors[0]
    return {
        "decision": decision,
        "probability": round(proba, 4),
        "confidence": round(max(proba, 1 - proba), 4),
        "top_factors": factors,
        "explanation": (
            f"Your application was {decision} primarily because of "
            f"{top['label'].lower()} "
            f"({'raising' if top['direction'] == 'increases' else 'lowering'} "
            f"the approval likelihood)."
        ),
        "is_mock": False,
    }


class handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:  # CORS preflight
        self._send(204, {})

    def do_POST(self) -> None:
        try:
            length = int(self.headers.get("content-length", 0) or 0)
            raw = self.rfile.read(length) if length else b"{}"
            payload = json.loads(raw or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._send(400, {"error": "Invalid JSON body."})

        try:
            result = run_prediction(payload)
        except ValueError as e:
            return self._send(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001 - surface for the demo
            return self._send(500, {"error": f"Prediction failed: {e}"})

        self._send(200, result)
