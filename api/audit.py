"""
Vercel Python serverless function: POST /api/audit

Runs a batch fairness audit of the loan model over lib/sample_data.csv and
returns the AuditResult shape from lib/types.ts (same shape as
lib/mock_audit_results.json), with 95% bootstrap CIs.

Headline 4 metrics are computed on `gender` (the primary protected attribute,
matching the worst-dimension narrative); `age_group` appears in the per-group
breakdown and the intersectional matrix.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from pathlib import Path

LIB = Path(__file__).resolve().parents[1] / "lib"
N_BOOTSTRAP = 200
N_BINS = 10
SEED = 42

DESCRIPTIONS = {
    "demographic_parity": "Gap in approval rate between groups, regardless of whether they would repay.",
    "equal_opportunity": "Gap in approval rate among applicants who would actually repay the loan.",
    "predictive_parity": "Gap in precision: of those approved, how many actually repay, across groups.",
    "calibration": "Gap between predicted probability and actual repayment rate across score bins.",
}
LABELS = {
    "demographic_parity": "Demographic Parity",
    "equal_opportunity": "Equal Opportunity",
    "predictive_parity": "Predictive Parity",
    "calibration": "Calibration",
}

_state: dict = {}


def _ensure_loaded() -> dict:
    if _state:
        return _state
    import joblib
    import numpy as np
    import pandas as pd

    contract = json.loads((LIB / "feature_names.json").read_text())
    model = joblib.load(LIB / "model.pkl")
    df = pd.read_csv(LIB / "sample_data.csv")
    order = contract["feature_order"]

    proba = model.predict_proba(df[order])[:, 1]
    y_pred = (proba >= 0.5).astype(int)
    y_true = df["label"].to_numpy().astype(int)

    _state.update(
        np=np,
        pd=pd,
        df=df,
        proba=proba,
        y_pred=y_pred,
        y_true=y_true,
        gender=df["gender"].to_numpy(),
        age_group=df["age_group"].to_numpy(),
    )
    return _state


def _calibration_difference(np, y_true, proba, sens, idx) -> float:
    """Max over score bins of (max - min) per-group actual positive rate,
    averaged weighted by bin size."""
    yt, pr, sf = y_true[idx], proba[idx], sens[idx]
    bins = np.linspace(0.0, 1.0, N_BINS + 1)
    which = np.clip(np.digitize(pr, bins[1:-1]), 0, N_BINS - 1)
    groups = np.unique(sf)
    total, acc = 0, 0.0
    for b in range(N_BINS):
        m = which == b
        if m.sum() == 0:
            continue
        rates = []
        for g in groups:
            gm = m & (sf == g)
            if gm.sum() > 0:
                rates.append(yt[gm].mean())
        if len(rates) >= 2:
            acc += (max(rates) - min(rates)) * m.sum()
            total += m.sum()
    return float(acc / total) if total else 0.0


def _metrics_for(np, idx) -> dict:
    from fairlearn.metrics import (
        MetricFrame,
        demographic_parity_difference,
        equalized_odds_difference,
    )
    from sklearn.metrics import precision_score

    st = _state
    yt, yp, sf = st["y_true"][idx], st["y_pred"][idx], st["gender"][idx]
    out = {}
    try:
        out["demographic_parity"] = float(
            demographic_parity_difference(yt, yp, sensitive_features=sf)
        )
    except Exception:
        out["demographic_parity"] = float("nan")
    try:
        out["equal_opportunity"] = float(
            equalized_odds_difference(yt, yp, sensitive_features=sf)
        )
    except Exception:
        out["equal_opportunity"] = float("nan")
    try:
        mf = MetricFrame(
            metrics=lambda a, b: precision_score(a, b, zero_division=0),
            y_true=yt,
            y_pred=yp,
            sensitive_features=sf,
        )
        out["predictive_parity"] = float(mf.difference(method="between_groups"))
    except Exception:
        out["predictive_parity"] = float("nan")
    out["calibration"] = _calibration_difference(
        np, st["y_true"], st["proba"], st["gender"], idx
    )
    return out


def run_audit() -> dict:
    st = _ensure_loaded()
    np = st["np"]
    n = len(st["y_true"])
    all_idx = np.arange(n)

    point = _metrics_for(np, all_idx)

    rng = np.random.default_rng(SEED)
    samples: dict[str, list] = {k: [] for k in point}
    for _ in range(N_BOOTSTRAP):
        bi = rng.integers(0, n, n)
        m = _metrics_for(np, bi)
        for k, v in m.items():
            if not np.isnan(v):
                samples[k].append(v)

    def group_rates(sens):
        vals = []
        for g in sorted(np.unique(sens)):
            mask = sens == g
            vals.append(
                {
                    "group": str(g),
                    "approval_rate": round(float(st["y_pred"][mask].mean()), 4),
                    "n": int(mask.sum()),
                }
            )
        return vals

    per_group = {
        "gender": group_rates(st["gender"]),
        "age_group": sorted(
            group_rates(st["age_group"]),
            key=lambda d: ["young", "middle", "senior"].index(d["group"]),
        ),
    }

    metrics = []
    for k in ["demographic_parity", "equal_opportunity", "predictive_parity", "calibration"]:
        arr = np.array(samples[k]) if samples[k] else np.array([point[k]])
        metrics.append(
            {
                "key": k,
                "label": LABELS[k],
                "value": round(float(point[k]), 4),
                "ci_lower": round(float(np.percentile(arr, 2.5)), 4),
                "ci_upper": round(float(np.percentile(arr, 97.5)), 4),
                "description": DESCRIPTIONS[k],
            }
        )

    worst = max(metrics, key=lambda m: m["value"])
    g = {r["group"]: r for r in per_group["gender"]}
    male = g.get("male", {}).get("approval_rate", 0.0)
    female = g.get("female", {}).get("approval_rate", 0.0)
    fairscore = round(max(0.0, min(1.0, 1.0 - worst["value"])), 2)

    # gender × age_group intersectional approval-rate matrix
    rows = ["male", "female"]
    cols = ["young", "middle", "senior"]
    cells = []
    for r in rows:
        rc = []
        for c in cols:
            mask = (st["gender"] == r) & (st["age_group"] == c)
            cnt = int(mask.sum())
            rc.append(
                {
                    "approval_rate": round(
                        float(st["y_pred"][mask].mean()) if cnt else 0.0, 4
                    ),
                    "n": cnt,
                }
            )
        cells.append(rc)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sample_size": n,
        "is_mock": False,
        "overall_fairscore": fairscore,
        "metrics": metrics,
        "per_group": per_group,
        "worst_dimension": {
            "metric": worst["key"],
            "label": worst["label"],
            "value": worst["value"],
            "explanation": (
                f"{worst['label']} is the largest disparity FairScore detected "
                f"({worst['value']:.3f}). Male applicants are approved "
                f"{male * 100:.1f}% of the time vs {female * 100:.1f}% for "
                f"female applicants — a {abs(male - female) * 100:.1f} "
                f"percentage-point gap."
            ),
        },
        "intersectional": {
            "rows": "gender",
            "cols": "age_group",
            "row_values": rows,
            "col_values": cols,
            "cells": cells,
        },
    }


class handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:
        self._send(204, {})

    def _run(self) -> None:
        try:
            self._send(200, run_audit())
        except Exception as e:  # noqa: BLE001 - surface for the demo
            self._send(500, {"error": f"Audit failed: {e}"})

    def do_POST(self) -> None:
        self._run()

    def do_GET(self) -> None:
        self._run()
