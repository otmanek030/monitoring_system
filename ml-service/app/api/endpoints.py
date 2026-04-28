"""HTTP endpoints exposed by the ML service.

These are called by the backend (Node.js). The backend caches the
predictions in Postgres; this service is kept stateless and fast.
"""
from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException

from ..schemas.payloads import (
    AnomalyRequest, AnomalyResponse, BatchAnomalyRequest,
    FailureRequest, FailureResponse,
    RulRequest, RulResponse,
    TrainResponse,
)
from ..services import anomaly_detection, predictive_maintenance, rul_estimation
from ..database.db_connector import fetch_all

logger = logging.getLogger(__name__)
router = APIRouter()


# ---- Health -----------------------------------------------------------------

@router.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "ML Service",
        "models": {
            "anomaly":    anomaly_detection._model is not None,
            "predictive": predictive_maintenance._model is not None,
            "rul":        rul_estimation._model is not None,
        },
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


# ---- Anomaly ----------------------------------------------------------------

@router.post("/predict/anomaly", response_model=AnomalyResponse)
def predict_anomaly(req: AnomalyRequest):
    try:
        res = anomaly_detection.predict(req.values)
        return AnomalyResponse(sensor_id=req.sensor_id, **res)
    except Exception as e:
        logger.exception("anomaly predict failed")
        raise HTTPException(500, str(e))


@router.post("/predict/anomaly/batch")
def predict_anomaly_batch(req: BatchAnomalyRequest):
    """Score the last-30-min window of every sensor in one call.
    Used by the dashboard to paint an overview row.
    """
    if not req.sensor_ids:
        return []
    # Pull recent windows from the DB
    rows = fetch_all(
        """
        SELECT sensor_id, array_agg(value ORDER BY ts) AS vals
        FROM sensor_readings
        WHERE sensor_id = ANY(%s) AND ts > NOW() - INTERVAL '30 minutes'
        GROUP BY sensor_id
        """,
        (req.sensor_ids,),
    )
    out = []
    for r in rows:
        try:
            out.append({"sensor_id": r["sensor_id"],
                        **anomaly_detection.predict(r["vals"] or [])})
        except Exception as e:
            out.append({"sensor_id": r["sensor_id"], "error": str(e)})
    return out


# ---- Failure prediction -----------------------------------------------------

@router.post("/predict/failure", response_model=FailureResponse)
def predict_failure(req: FailureRequest):
    try:
        res = predictive_maintenance.predict(
            req.equipment_id,
            req.horizon_days,
            [f.model_dump() for f in req.features],
        )
        return FailureResponse(**res)
    except Exception as e:
        logger.exception("failure predict failed")
        raise HTTPException(500, str(e))


# ---- RUL --------------------------------------------------------------------

@router.post("/predict/rul", response_model=RulResponse)
def predict_rul(req: RulRequest):
    try:
        res = rul_estimation.predict(
            req.features,
            runtime_hours=req.runtime_hours,
            expected_life_hours=req.expected_life_hours,
        )
        return RulResponse(equipment_id=req.equipment_id, **res)
    except Exception as e:
        logger.exception("rul predict failed")
        raise HTTPException(500, str(e))


# ---- Training ---------------------------------------------------------------

@router.post("/train/{model}", response_model=TrainResponse)
def train_model(model: str):
    """Re-train one of the three models on synthetic data.

    Useful after adding new sensors or resetting the stack. In production
    this would pull labelled incidents from the DB instead.
    """
    mapping = {
        "anomaly":    anomaly_detection.train,
        "predictive": predictive_maintenance.train,
        "rul":        rul_estimation.train,
    }
    fn = mapping.get(model)
    if not fn:
        raise HTTPException(400, f"unknown model: {model}")
    metrics = fn()
    return TrainResponse(model=model, metrics=metrics)
