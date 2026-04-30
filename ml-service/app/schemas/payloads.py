"""Pydantic v2 schemas for request / response bodies."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, Field


# ---- Anomaly ----------------------------------------------------------------

class AnomalyRequest(BaseModel):
    sensor_id: int
    values: list[float] = Field(..., min_length=5)
    timestamps: Optional[list[datetime]] = None


class AnomalyResponse(BaseModel):
    sensor_id: int
    score: float
    is_anomaly: bool
    explanation: dict[str, float]


class BatchAnomalyRequest(BaseModel):
    sensor_ids: list[int]


# ---- Predictive maintenance -------------------------------------------------

class FeatureItem(BaseModel):
    tag_code: str
    measurement: Optional[str] = None
    avg_v: Optional[float] = None
    max_v: Optional[float] = None
    std_v: Optional[float] = None


class FailureRequest(BaseModel):
    equipment_id: int
    horizon_days: int = 7
    features: list[FeatureItem]


class FailureResponse(BaseModel):
    equipment_id: int
    horizon_days: int
    failure_prob: float
    predicted_class: Optional[str] = None
    confidence: float
    # Per-mode breakdown, sums to ~1. Computed in services/predictive_maintenance.py
    # so the dominant mode reflects the actual sensor that's drifting (vibration
    # → bearing, temperature → winding, …) instead of always being bearing_fault.
    mode_probabilities: Optional[dict[str, float]] = None
    # Diagnostic: raw XGBoost output before the calibration squash
    raw_failure_prob: Optional[float] = None


# ---- RUL --------------------------------------------------------------------

class RulRequest(BaseModel):
    equipment_id: int
    features: list[float]
    runtime_hours: Optional[float] = None
    expected_life_hours: Optional[float] = None


class RulResponse(BaseModel):
    equipment_id: int
    rul_hours: float
    rul_lower_95: float
    rul_upper_95: float
    health_index: float


# ---- Training ---------------------------------------------------------------

class TrainResponse(BaseModel):
    model: str
    metrics: dict[str, Any]
