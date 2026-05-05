'use strict';

/**
 * Predictions / anomalies / failure / RUL proxy routes.
 * Mounted at /api/predictions.
 */
const { Router } = require('express');
const ctrl = require('../controllers/mlController');
const cascadeCtrl = require('../controllers/cascadeController');
const { authRequired, requirePerm } = require('../middleware/auth');

const router = Router();
router.use(authRequired);

router.get ('/health',                               ctrl.health);
router.post('/anomaly',                              requirePerm('predictions','r'), ctrl.predictAnomaly);
router.post('/failure',                              requirePerm('predictions','r'), ctrl.predictFailure);
router.get ('/rul/:id',                              ctrl.rulLatest);
router.get ('/anomaly/:sensor_id/history',           ctrl.anomalyHistory);
router.get ('/failure/:equipment_id/history',        ctrl.failureHistory);

// ── Cascading failure prediction ───────────────────────────────────────────
// Top-N risky chains across the plant. Each entry includes the upstream root,
// the downstream equipment at risk, the combined risk score, and a human
// readable description suitable for an operator alert.
router.get ('/cascade',                              requirePerm('predictions','r'), cascadeCtrl.cascade);
router.get ('/cascade/graph',                        requirePerm('predictions','r'), cascadeCtrl.cascadeGraph);
router.get ('/cascade/:equipmentId',                 requirePerm('predictions','r'), cascadeCtrl.cascadeFor);

module.exports = router;
