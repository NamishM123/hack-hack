"""
FairScore — local model training (run once).

Generates the artifacts the app ships with:
  lib/model.pkl          fitted sklearn Pipeline (preprocessing + LogisticRegression)
  lib/sample_data.csv    held-out test set + sensitive attributes + true label (audit input)
  lib/feature_names.json the input contract shared by the form, predict, and audit

Dataset: German Credit ("credit-g" on OpenML, 1000 rows). The model is trained on
exactly the 8 fields the applicant form collects so the form -> model mapping is an
identity (no lossy translation at inference time).

NOTE: German Credit has no income column. `annual_income` is SYNTHESIZED here
(seeded, mildly associated with the label + credit amount, heavy noise) purely so
the demo form's income field is functional. It is a demo artifact, not real signal.

Run:  ./.venv/bin/python scripts/train_local.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.datasets import fetch_openml
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

import joblib

SEED = 42
ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "lib"

NUMERIC = ["annual_income", "loan_amount", "loan_duration_months", "age"]
CATEGORICAL = ["credit_history", "employment_length", "housing", "purpose"]
SENSITIVE = ["gender", "age_group"]

# German Credit native categories -> the form's canonical option strings.
# Training on the canonical strings makes the form/predict/audit contract identical.
# German Credit's native credit_history semantics are counterintuitive
# (its "critical/other existing credit" group has the LOWEST default rate,
# "no credits/all paid" the highest). Per the Phase 5 checkpoint decision,
# we relabel by empirical good-rate rank so the intuitive label ordinal
# matches real risk: best-sounding label -> lowest-default native category.
#   critical/other existing credit  good_rate 0.829  -> "paid back duly"
#   delayed previously              good_rate 0.682  -> "existing paid"
#   existing paid                   good_rate 0.681  -> "no credits"
#   all paid                        good_rate 0.429  -> "delayed"
#   no credits/all paid             good_rate 0.375  -> "critical"
CREDIT_HISTORY_MAP = {
    "critical/other existing credit": "paid back duly",
    "delayed previously": "existing paid",
    "existing paid": "no credits",
    "all paid": "delayed",
    "no credits/all paid": "critical",
}
EMPLOYMENT_MAP = {
    "unemployed": "unemployed",
    "<1": "<1 yr",
    "1<=X<4": "1-4 yrs",
    "4<=X<7": "4-7 yrs",
    ">=7": "7+ yrs",
}
HOUSING_MAP = {"own": "own", "rent": "rent", "for free": "free"}
PURPOSE_MAP = {
    "new car": "car",
    "used car": "car",
    "education": "education",
    "business": "business",
    "furniture/equipment": "furniture",
    "domestic appliance": "furniture",
    "radio/tv": "other",
    "repairs": "other",
    "other": "other",
    "retraining": "other",
}


def synthesize_income(df: pd.DataFrame, rng: np.random.Generator) -> np.ndarray:
    """Demo-only income. Lognormal base, mild lift for approved + larger loans,
    heavy multiplicative noise so it never dominates the model."""
    base = rng.lognormal(mean=10.6, sigma=0.45, size=len(df))  # ~$40k median
    approved_lift = np.where(df["_label"].to_numpy() == 1, 1.12, 0.92)
    amount_lift = 1.0 + (df["loan_amount"].to_numpy() / df["loan_amount"].max()) * 0.25
    noise = rng.normal(1.0, 0.35, size=len(df)).clip(0.4, 2.2)
    income = base * approved_lift * amount_lift * noise
    return np.round(income / 100.0) * 100.0


def main() -> int:
    LIB.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(SEED)

    print("Loading German Credit (credit-g) from OpenML ...")
    try:
        ds = fetch_openml("credit-g", version=1, as_frame=True)
    except Exception as e:  # network / OpenML down
        print(f"ERROR: could not fetch dataset: {e}", file=sys.stderr)
        print("This script needs internet on first run (sklearn caches afterward).", file=sys.stderr)
        return 1

    raw = ds.frame.copy()
    # Target: 'good' credit -> approve (1), 'bad' -> deny (0)
    raw["_label"] = (raw["class"] == "good").astype(int)

    df = pd.DataFrame()
    df["loan_duration_months"] = raw["duration"].astype(float)
    df["loan_amount"] = raw["credit_amount"].astype(float)
    df["age"] = raw["age"].astype(float)
    df["credit_history"] = raw["credit_history"].map(CREDIT_HISTORY_MAP)
    df["employment_length"] = raw["employment"].map(EMPLOYMENT_MAP)
    df["housing"] = raw["housing"].map(HOUSING_MAP)
    df["purpose"] = raw["purpose"].map(PURPOSE_MAP)
    df["_label"] = raw["_label"]
    df["annual_income"] = synthesize_income(df, rng)

    # Sensitive attributes for fairness testing.
    # gender is real signal: German Credit's personal_status encodes sex.
    df["gender"] = np.where(
        raw["personal_status"].astype(str).str.contains("female"), "female", "male"
    )
    df["age_group"] = pd.cut(
        df["age"], bins=[0, 30, 50, 200], labels=["young", "middle", "senior"]
    ).astype(str)

    unmapped = df[CATEGORICAL].isna().any().any()
    if unmapped:
        print("ERROR: unmapped category encountered:", file=sys.stderr)
        print(df[CATEGORICAL].isna().sum(), file=sys.stderr)
        return 1

    feature_cols = NUMERIC + CATEGORICAL
    X = df[feature_cols]
    y = df["_label"]

    X_train, X_test, y_train, y_test, idx_train, idx_test = train_test_split(
        X, y, df.index, test_size=0.25, random_state=SEED, stratify=y
    )

    pre = ColumnTransformer(
        transformers=[
            ("num", StandardScaler(), NUMERIC),
            ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL),
        ]
    )
    model = Pipeline(
        steps=[
            ("pre", pre),
            (
                "clf",
                LogisticRegression(
                    max_iter=1000, class_weight="balanced", random_state=SEED
                ),
            ),
        ]
    )
    model.fit(X_train, y_train)

    proba = model.predict_proba(X_test)[:, 1]
    pred = (proba >= 0.5).astype(int)
    acc = accuracy_score(y_test, pred)
    auc = roc_auc_score(y_test, proba)

    # Held-out set for the fairness audit: model features + sensitive attrs + true label.
    sample = df.loc[idx_test, feature_cols + SENSITIVE].copy()
    sample["label"] = y_test.to_numpy()
    sample.to_csv(LIB / "sample_data.csv", index=False)

    joblib.dump(model, LIB / "model.pkl")

    cat_options = {c: sorted(df[c].dropna().unique().tolist()) for c in CATEGORICAL}
    contract = {
        "numeric_features": NUMERIC,
        "categorical_features": CATEGORICAL,
        "categorical_options": cat_options,
        "feature_order": feature_cols,
        "sensitive_attributes": {
            "gender": sorted(df["gender"].unique().tolist()),
            "age_group": ["young", "middle", "senior"],
        },
        "target": {"name": "label", "approve": 1, "deny": 0},
        "dataset": "German Credit (OpenML credit-g)",
        "notes": "annual_income is a synthesized demo feature; German Credit has no income column.",
    }
    (LIB / "feature_names.json").write_text(json.dumps(contract, indent=2))

    pkl_mb = (LIB / "model.pkl").stat().st_size / 1e6
    print("\n=== Phase 2 complete ===")
    print(f"rows: {len(df)} | approve rate: {y.mean():.3f}")
    print(f"test accuracy: {acc:.3f} | test ROC-AUC: {auc:.3f}")
    print(
        "gender counts:",
        df["gender"].value_counts().to_dict(),
        "| age_group:",
        df["age_group"].value_counts().to_dict(),
    )
    print(f"lib/model.pkl         {pkl_mb:.3f} MB")
    print(f"lib/sample_data.csv   {len(sample)} rows")
    print(f"lib/feature_names.json {len(contract['feature_order'])} features")
    if pkl_mb >= 50:
        print(f"ERROR: model.pkl is {pkl_mb:.1f} MB (>=50MB limit)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
