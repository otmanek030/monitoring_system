'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/equipmentController');
const { authRequired, requirePerm } = require('../middleware/auth');

const router = Router();
router.use(authRequired);

router.get   ('/health',        ctrl.healthOverview);
router.get   ('/',              ctrl.list);
router.get   ('/:id',           ctrl.get);
router.get   ('/:id/sensors',   ctrl.listSensors);
router.patch ('/:id/status',      requirePerm('equipment', 'w'), ctrl.setStatus);
router.patch ('/:id/responsible', requirePerm('equipment', 'w'), ctrl.setResponsible);

module.exports = router;
