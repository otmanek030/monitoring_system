'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/dataController');
const { authRequired, requirePerm } = require('../middleware/auth');

const router = Router();
router.use(authRequired);

// Sensors
router.get ('/latest',             ctrl.latest);
router.get ('/',                   ctrl.listSensors);
router.get ('/:id',                ctrl.getSensor);

// Thresholds (supervisor+)
router.patch('/:id/thresholds',    requirePerm('thresholds', 'w'), ctrl.updateThresholds);

// Readings
router.get ('/:id/readings',       ctrl.readings);
router.post('/:id/readings',       requirePerm('equipment', 'w'), ctrl.ingest);

module.exports = router;
