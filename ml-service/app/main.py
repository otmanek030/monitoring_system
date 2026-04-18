"""Phoswatch ML service entry point (FastAPI)."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .api.endpoints import router as api_router
from .services import anomaly_detection, predictive_maintenance, rul_estimation

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("phoswatch.ml")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: load or bootstrap-train the three models
    logger.info("phoswatch ML service starting")
    for name, svc in [
        ("anomaly",    anomaly_detection),
        ("predictive", predictive_maintenance),
        ("rul",        rul_estimation),
    ]:
        try:
            if svc.load() is None and settings.bootstrap_train:
                logger.info("training %s on synthetic data (first boot)", name)
                svc.train()
            elif svc.load() is None:
                logger.warning("no %s model and bootstrap disabled", name)
        except Exception as exc:  # pragma: no cover
            logger.exception("%s model bootstrap failed: %s", name, exc)
    logger.info("models ready")
    yield
    logger.info("phoswatch ML service stopping")


app = FastAPI(
    title="Phoswatch ML Service",
    description="Anomaly detection, predictive maintenance and RUL estimation "
                "for the OCP Benguerir phosphate washing & flotation plant.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],            # API is called by the backend over the
    allow_credentials=True,          # Docker network; tighten for prod edge.
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/")
def root():
    return {
        "service": "Phoswatch ML Service",
        "version": "1.0.0",
        "time": datetime.utcnow().isoformat() + "Z",
        "endpoints": [
            "/health",
            "/predict/anomaly",
            "/predict/anomaly/batch",
            "/predict/failure",
            "/predict/rul",
            "/train/{anomaly|predictive|rul}",
        ],
    }
