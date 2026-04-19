"""Centralised configuration for the ML service."""
from __future__ import annotations

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()


class Settings:
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql://phoswatch_user:phoswatch_pass@database:5432/phoswatch_db",
    )
    model_path: Path = Path(os.getenv("MODEL_PATH", "/app/models"))
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    bootstrap_train: bool = os.getenv("BOOTSTRAP_TRAIN", "true").lower() in ("1", "true", "yes")

    # Model filenames (versioned - matches the DB ml_models seed)
    anomaly_file: str = "anomaly_iforest_v0.1.joblib"
    # v0.2 bumped: classifier now trains on a purpose-built dataset with
    # overlapping healthy / failing distributions so failure_prob actually
    # varies across assets instead of pegging at 100 %.
    predictive_file: str = "predictive_xgb_v0.2.joblib"
    # v0.2 bumped because the RUL training distribution moved from [2000, 8000]
    # down to [24, 2160] hours so predictions actually vary across assets
    # inside the maintenance-planning window (1 h - 90 d).
    rul_file: str = "rul_mlp_v0.2.joblib"


settings = Settings()
settings.model_path.mkdir(parents=True, exist_ok=True)
