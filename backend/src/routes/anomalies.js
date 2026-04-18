'use strict';

/**
 * Predictions / anomalies / failure / RUL proxy routes.
 * Mounted at /api/predictions.
 */
const { Router } = require('express');
const ctrl = require('../controllers/mlController');
const { authRequired, requirePerm } = require('../middleware/auth');

const router = Router();
router.use(authRequired);

router.get ('/health',                               ctrl.health);
router.post('/anomaly',                              requirePerm('predictions','r'), ctrl.predictAnomaly);
router.post('/failure',                              requirePerm('predictions','r'), ctrl.predictFailure);
router.get ('/rul/:id',                              ctrl.rulLatest);
router.get ('/anomaly/:sensor_id/history',           ctrl.anomalyHistory);
router.get ('/failure/:equipment_id/history',        ctrl.failureHistory);

module.exports = router;
