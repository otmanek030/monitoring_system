"""Predictive maintenance: failure probability within 7/14 days (XGBoost).

The training set is synthetic but the contract matches what the backend
actually sends (`features` is a list of `{tag_code, measurement, avg_v,
max_v, std_v}` dicts aggregated over the last 6 hours).
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import joblib
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from xgboost import XGBClassifier

from ..config import settings
from ..utils.data_processor import synthetic_training_set

logger = logging.getLogger(__name__)

_model: Pipeline | None = None

FAILURE_MODES = [
    "bearing_fault",
    "winding_overheat",
    "cavitation",
    "misalignment",
    "belt_slip",
]


def _pipeline() -> Pipeline:
    return Pipeline([
        ("scale", StandardScaler()),
        ("xgb", XGBClassifier(
            n_estimators=200, max_depth=4, learning_rate=0.08,
            subsample=0.8, colsample_bytree=0.8,
            objective="binary:logistic", eval_metric="logloss",
            tree_method="hist", random_state=42,
        )),
    ])


def path() -> Path:
    return settings.model_path / settings.predictive_file


def load() -> Pipeline | None:
    global _model
    p = path()
    try:
        if p.exists() and p.stat().st_size > 0:
            _model = joblib.load(p)
            logger.info("predictive model loaded from %s", p)
            return _model
    except Exception as exc:
        logger.warning("failed to load predictive model: %s", exc)
    return None


def train(X: np.ndarray | None = None, y: np.ndarray | None = None) -> dict:
    global _model
    if X is None or y is None:
        X, y = synthetic_training_set(n_samples=6000, contamination=0.15)
    pipe = _pipeline()
    pipe.fit(X, y)
    joblib.dump(pipe, path())
    _model = pipe

    from sklearn.metrics import roc_auc_score, accuracy_score
    p = pipe.predict_proba(X)[:, 1]
    metrics = {
        "n_samples": int(X.shape[0]),
        "auc": float(roc_auc_score(y, p)),
        "acc": float(accuracy_score(y, (p > 0.5).astype(int))),
        "horizon_days_default": 7,
    }
    logger.info("predictive model trained: %s", metrics)
    return metrics


def ensure_ready():
    if _model is None and load() is None:
        train()


def _vector_from_features(features: list[dict]) -> np.ndarray:
    """Collapse the backend's per-sensor aggregates into a fixed-length vector.

    We just pool (mean, std, max) across sensors and pad with the jerk proxy.
    Real deployments would use a sensor-specific schema; this MVP is robust
    to any number of sensors.
    """
    if not features:
        return np.zeros(10)
    avg = np.array([float(f.get("avg_v") or 0) for f in features])
    mx  = np.array([float(f.get("max_v") or 0) for f in features])
    std = np.array([float(f.get("std_v") or 0) for f in features])
    arr = np.array([
        float(np.mean(avg)), float(np.std(avg)),
        float(np.min(avg)),  float(np.max(avg)),
        float(np.mean(mx)),  float(np.max(mx)),
        float(np.mean(std)), float(np.max(std)),
        float(np.ptp(avg)),  float(np.ptp(std) if std.size else 0),
    ], dtype=float)
    return arr


def predict(equipment_id: int, horizon_days: int, features: list[dict]) -> dict:
    ensure_ready()
    x = _vector_from_features(features).reshape(1, -1)
    assert _model is not None
    proba = float(_model.predict_proba(x)[0, 1])
    # Fake a failure mode using a simple hash of the top feature index
    top = int(np.argmax(np.abs(x[0])))
    predicted_class = FAILURE_MODES[top % len(FAILURE_MODES)] if proba > 0.5 else None
    return {
        "equipment_id": equipment_id,
        "horizon_days": horizon_days,
        "failure_prob": proba,
        "predicted_class": predicted_class,
        "confidence": float(1 - 2 * abs(proba - 0.5) * 0.5),
    }
