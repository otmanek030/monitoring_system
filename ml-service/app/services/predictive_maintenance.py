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


def _synthetic_failure_dataset(n_samples: int = 6000, failure_ratio: float = 0.35,
                               seed: int = 42):
    """Purpose-built training set for the failure-prob XGBoost.

    The previous implementation reused `synthetic_training_set` (designed for
    anomaly detection), which made the failure class *extremely* separable —
    so at inference the StandardScaler+XGBoost pegged every real sensor input
    at probability 1.0. Here we build features whose distributions actually
    overlap between "healthy" and "about to fail", so the classifier learns
    a gradient between 0 and 1 instead of a hard yes/no threshold.

    Feature layout matches `_vector_from_features`:
       [mean_avg, std_avg, min_avg, max_avg, mean_max, max_max,
        mean_std, max_std, range_avg, range_std]
    """
    rng = np.random.default_rng(seed)
    n_fail = int(n_samples * failure_ratio)
    n_ok = n_samples - n_fail

    def _sample(is_failure: bool, n: int) -> np.ndarray:
        # base scale shared by both classes so their distributions overlap
        mean_avg = rng.normal(0.5, 0.3, n)
        std_avg  = rng.normal(0.2, 0.1, n).clip(0.01, None)
        mx       = rng.normal(1.0, 0.3, n)
        sd       = rng.normal(0.3, 0.15, n).clip(0.01, None)

        if is_failure:
            # failing assets: slightly higher mean, MUCH higher variance/jerk
            mean_avg += rng.normal(0.4, 0.25, n)
            std_avg  += rng.normal(0.5, 0.25, n).clip(0, None)
            mx       += rng.normal(0.8, 0.4, n)
            sd       += rng.normal(0.7, 0.35, n).clip(0, None)

        return np.column_stack([
            mean_avg,            # mean_avg
            std_avg,             # std_avg
            mean_avg - rng.uniform(0.1, 0.3, n),   # min_avg
            mean_avg + rng.uniform(0.1, 0.3, n),   # max_avg
            mx,                  # mean_max
            mx + rng.uniform(0.0, 0.5, n),         # max_max
            sd,                  # mean_std
            sd + rng.uniform(0.0, 0.4, n),         # max_std
            rng.uniform(0.05, 0.5, n) + (0.8 if is_failure else 0) * rng.random(n),
            rng.uniform(0.05, 0.5, n) + (0.6 if is_failure else 0) * rng.random(n),
        ])

    X_ok   = _sample(False, n_ok)
    X_fail = _sample(True,  n_fail)
    X = np.vstack([X_ok, X_fail])
    y = np.concatenate([np.zeros(n_ok), np.ones(n_fail)])
    idx = rng.permutation(X.shape[0])
    return X[idx], y[idx]


def train(X: np.ndarray | None = None, y: np.ndarray | None = None) -> dict:
    global _model
    if X is None or y is None:
        X, y = _synthetic_failure_dataset(n_samples=6000, failure_ratio=0.35)
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
