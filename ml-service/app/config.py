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
    anomaly_file: str = "anomaly_iforest_v0.1.joblib"
    predictive_file: str = "predictive_xgb_v0.2.joblib"
    rul_file: str = "rul_mlp_v0.2.joblib"


settings = Settings()
settings.model_path.mkdir(parents=True, exist_ok=True)
