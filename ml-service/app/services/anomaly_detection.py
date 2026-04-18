"""Anomaly detection service (Isolation Forest).

The model is trained once at startup on synthetic data shaped like
`window_features` output. It is hot-swappable: calling `train()` again
overwrites the saved pickle and reloads the in-memory instance.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterable

import numpy as np
import joblib
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline

from ..config import settings
from ..utils.data_processor import window_features, synthetic_training_set

logger = logging.getLogger(__name__)

_model: Pipeline | None = None


def _pipeline() -> Pipeline:
    return Pipeline([
        ("scale", StandardScaler()),
        ("iforest", IsolationForest(n_estimators=200,
                                    contamination=0.02,
                                    random_state=42,
                                    n_jobs=-1)),
    ])


def path() -> Path:
    return settings.model_path / settings.anomaly_file


def load() -> Pipeline | None:
    """Load the saved model if it exists and is non-empty."""
    global _model
    p = path()
    try:
        if p.exists() and p.stat().st_size > 0:
            _model = joblib.load(p)
            logger.info("anomaly model loaded from %s", p)
            return _model
    except Exception as exc:
        logger.warning("failed to load anomaly model: %s", exc)
    return None


def train(X: np.ndarray | None = None) -> dict:
    """Fit the pipeline and persist it. Returns training metrics."""
    global _model
    if X is None:
        X, _y = synthetic_training_set()
    pipe = _pipeline()
    pipe.fit(X)
    joblib.dump(pipe, path())
    _model = pipe
    # Decision score summary on train (no held-out set for synthetic bootstrap)
    scores = pipe.named_steps["iforest"].decision_function(
        pipe.named_steps["scale"].transform(X))
    metrics = {
        "n_samples": int(X.shape[0]),
        "n_features": int(X.shape[1]),
        "decision_mean": float(np.mean(scores)),
        "decision_std": float(np.std(scores)),
        "contamination": 0.02,
    }
    logger.info("anomaly model trained: %s", metrics)
    return metrics


def ensure_ready():
    """Guarantee a model is in memory: load-or-train."""
    if _model is None and load() is None:
        train()


def predict(values: Iterable[float]) -> dict:
    """Score a single window of raw sensor values.

    Returns:
      {
        "score": float      (higher = more normal, sklearn convention),
        "is_anomaly": bool,
        "explanation": {"feature": float, ...}
      }
    """
    ensure_ready()
    feats = window_features(np.asarray(list(values), dtype=float)).reshape(1, -1)
    assert _model is not None
    score = float(_model.decision_function(feats)[0])
    label = int(_model.predict(feats)[0])  # 1 = normal, -1 = anomaly
    names = ["mean","std","min","max","p25","p75","range","last","slope","jerk"]
    return {
        "score": score,
        "is_anomaly": label == -1,
        "explanation": dict(zip(names, feats[0].tolist())),
    }
