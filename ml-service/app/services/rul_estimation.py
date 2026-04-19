"""Remaining Useful Life estimation.

The primary target is an LSTM, but a full TF install is heavy for a
student PFE dev laptop so we default to an MLPRegressor (scikit-learn)
that shares the same `predict(features) -> hours` contract. Swapping
in a Keras LSTM is a drop-in replacement in `_model` / `train()`.
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import joblib
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline

from ..config import settings
from ..utils.data_processor import synthetic_rul_dataset

logger = logging.getLogger(__name__)

_model: Pipeline | None = None


def _pipeline() -> Pipeline:
    return Pipeline([
        ("scale", StandardScaler()),
        ("mlp", MLPRegressor(
            hidden_layer_sizes=(64, 32),
            activation="relu",
            solver="adam",
            learning_rate_init=1e-3,
            max_iter=200,
            random_state=42,
        )),
    ])


def path() -> Path:
    return settings.model_path / settings.rul_file


def load() -> Pipeline | None:
    global _model
    p = path()
    try:
        if p.exists() and p.stat().st_size > 0:
            _model = joblib.load(p)
            logger.info("rul model loaded from %s", p)
            return _model
    except Exception as exc:
        logger.warning("failed to load rul model: %s", exc)
    return None


def train(X: np.ndarray | None = None, y: np.ndarray | None = None) -> dict:
    global _model
    if X is None or y is None:
        X, y = synthetic_rul_dataset()
    pipe = _pipeline()
    pipe.fit(X, y)
    joblib.dump(pipe, path())
    _model = pipe

    yhat = pipe.predict(X)
    rmse = float(np.sqrt(np.mean((yhat - y) ** 2)))
    logger.info("rul model trained rmse=%.2f", rmse)
    return {"n_samples": int(X.shape[0]), "rmse_hours": rmse}


def ensure_ready():
    if _model is None and load() is None:
        train()


# ─── Physical bounds for an industrial phosphate-plant asset ─────────────────
# The predictive-maintenance horizon we care about is "days to weeks",
# at most ~3 months. Anything outside this range is either (a) a broken
# regressor output, or (b) an asset so healthy that giving a specific
# RUL is misleading — in both cases we cap and communicate uncertainty.
RUL_MIN_HOURS = 1.0              # 1 hour  — never "0" unless already failed
RUL_MAX_HOURS = 90.0 * 24.0      # 90 days — sensible planning horizon
RUL_REFERENCE_HOURS = RUL_MAX_HOURS  # health_index reference uses same scale


def predict(features: list[float] | np.ndarray, runtime_hours: float | None = None,
            expected_life_hours: float | None = None) -> dict:
    """Predict RUL (hours) and derive a 0..1 health index.

    The raw regressor output is **clamped to [1 h, 90 d]** so the downstream
    dashboard always presents a realistic maintenance-planning window
    (days → weeks → months, never multi-year). Values outside this range
    are almost always model drift or noise rather than useful predictions.

    If runtime_hours and expected_life_hours are provided we also emit a
    physics-prior version: health = clip(1 - runtime/expected_life, 0, 1).
    Final health = 0.7 * model_hi + 0.3 * prior_hi.
    """
    ensure_ready()
    x = np.asarray(list(features), dtype=float).reshape(1, -1)
    assert _model is not None
    raw_hours = float(_model.predict(x)[0])

    # ── Clamp to a realistic maintenance-planning window ────────────────
    # This is the single most important line in this file: without it a
    # drifted regressor can output millions of hours.
    rul_hours = float(np.clip(raw_hours, RUL_MIN_HOURS, RUL_MAX_HOURS))

    # naive 95% CI via +/- 20%, also clamped so the UI never sees silly bounds
    lower = float(np.clip(rul_hours * 0.8, RUL_MIN_HOURS, RUL_MAX_HOURS))
    upper = float(np.clip(rul_hours * 1.2, RUL_MIN_HOURS, RUL_MAX_HOURS))

    # health index: how much life is left vs the 90-day reference
    model_hi = min(1.0, rul_hours / RUL_REFERENCE_HOURS)
    prior_hi = None
    if runtime_hours is not None and expected_life_hours:
        prior_hi = max(0.0, min(1.0, 1.0 - float(runtime_hours) / float(expected_life_hours)))
    health = 0.7 * model_hi + 0.3 * (prior_hi if prior_hi is not None else model_hi)

    return {
        "rul_hours": rul_hours,
        "rul_lower_95": lower,
        "rul_upper_95": upper,
        "health_index": float(max(0.0, min(1.0, health))),
        # Flag added so the UI / logs can tell when we had to clip noisy output.
        "raw_rul_hours": float(max(0.0, raw_hours)),
        "clipped": bool(raw_hours < RUL_MIN_HOURS or raw_hours > RUL_MAX_HOURS),
    }
