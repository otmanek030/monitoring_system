"""Feature engineering used by every model.

All models take either a raw univariate series (anomaly model) or an
aggregated feature vector (predictive / RUL).  Keeping the feature
contract here means the backend, the training script and the online
scorer all agree on shapes.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


# -------- Feature building ---------------------------------------------------

def window_features(values: np.ndarray) -> np.ndarray:
    """Convert a 1-D time window into a small feature vector.

    Features: [mean, std, min, max, p25, p75, range, last, slope, abs_jerk].
    """
    x = np.asarray(values, dtype=float)
    if x.size == 0:
        return np.zeros(10)

    p25, p75 = np.percentile(x, [25, 75])
    slope = (x[-1] - x[0]) / max(x.size - 1, 1)
    jerk = float(np.mean(np.abs(np.diff(x)))) if x.size > 1 else 0.0

    return np.array([
        float(np.mean(x)),
        float(np.std(x)),
        float(np.min(x)),
        float(np.max(x)),
        float(p25),
        float(p75),
        float(np.max(x) - np.min(x)),
        float(x[-1]),
        float(slope),
        jerk,
    ], dtype=float)


def synthetic_training_set(n_samples: int = 4000, n_features: int = 10,
                           contamination: float = 0.02,
                           seed: int = 42):
    """Generate a labelled synthetic dataset for bootstrap training.

    90%+ healthy windows (mean features around 0 with small noise),
    a few % degraded windows (shifted mean, inflated variance), and a
    contamination of outright anomalies.
    """
    rng = np.random.default_rng(seed)
    X_healthy = rng.normal(0.0, 1.0, size=(int(n_samples * (1 - contamination)), n_features))

    n_anom = n_samples - X_healthy.shape[0]
    X_anom = rng.normal(0.0, 1.0, size=(n_anom, n_features))
    X_anom[:, 0] += rng.uniform(4, 8, size=n_anom)       # shifted mean
    X_anom[:, 1] *= rng.uniform(3, 6, size=n_anom)       # inflated std
    X_anom[:, -1] += rng.uniform(2, 5, size=n_anom)      # larger jerk

    X = np.vstack([X_healthy, X_anom])
    y = np.concatenate([np.zeros(X_healthy.shape[0]),
                        np.ones(X_anom.shape[0])])
    idx = rng.permutation(X.shape[0])
    return X[idx], y[idx]


def synthetic_rul_dataset(n_units: int = 150, seed: int = 42):
    """RUL regression data: per-window features -> remaining useful life (hours).

    Each "unit" has a random total life between 2000-8000 h; we simulate
    running-condition features that drift towards end-of-life.
    """
    rng = np.random.default_rng(seed)
    X, y = [], []
    for _ in range(n_units):
        life = int(rng.integers(2000, 8000))
        for t in range(0, life, int(rng.integers(50, 200))):
            rul = life - t
            # features degrade with age
            age = t / life
            feats = [
                rng.normal(0.5 + age, 0.1),     # mean "vibration-like"
                rng.normal(1.0 + 2 * age, 0.2), # std inflates
                rng.normal(-1.0 - age, 0.1),
                rng.normal(1.0 + age, 0.2),
                rng.normal(0.0, 0.1),
                rng.normal(0.5 + age, 0.1),
                rng.normal(2.0 * age, 0.1),
                rng.normal(0.2 + age, 0.1),
                rng.normal(0.01 * (1 + age), 0.005),
                rng.normal(0.02 * (1 + age), 0.005),
            ]
            X.append(feats); y.append(rul)
    return np.asarray(X, dtype=float), np.asarray(y, dtype=float)
