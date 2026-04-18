"""Offline tests for the three ML services.

These don't need the DB; they just exercise the train/predict pipelines
on synthetic data.
"""
from app.services import anomaly_detection, predictive_maintenance, rul_estimation


def test_anomaly_trains_and_predicts(tmp_path, monkeypatch):
    monkeypatch.setattr(anomaly_detection.settings, "model_path", tmp_path)
    m = anomaly_detection.train()
    assert m["n_samples"] > 0
    out = anomaly_detection.predict([0.1, 0.2, 0.15, 0.12, 0.11, 0.13])
    assert "score" in out and "is_anomaly" in out


def test_predictive_trains_and_predicts(tmp_path, monkeypatch):
    monkeypatch.setattr(predictive_maintenance.settings, "model_path", tmp_path)
    m = predictive_maintenance.train()
    assert 0.0 <= m["auc"] <= 1.0
    out = predictive_maintenance.predict(
        equipment_id=1, horizon_days=7,
        features=[{"tag_code": "X", "avg_v": 1.0, "max_v": 2.0, "std_v": 0.5}],
    )
    assert 0.0 <= out["failure_prob"] <= 1.0


def test_rul_trains_and_predicts(tmp_path, monkeypatch):
    monkeypatch.setattr(rul_estimation.settings, "model_path", tmp_path)
    m = rul_estimation.train()
    assert m["rmse_hours"] > 0
    out = rul_estimation.predict([0.2] * 10, runtime_hours=1000, expected_life_hours=5000)
    assert out["rul_hours"] >= 0
    assert 0.0 <= out["health_index"] <= 1.0
