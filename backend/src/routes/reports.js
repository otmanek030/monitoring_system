'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/reportController');
const { authRequired, requirePerm } = require('../middleware/auth');

const router = Router();
router.use(authRequired, requirePerm('reports', 'r'));

router.get('/equipment/:id/xlsx', ctrl.equipmentXlsx);
router.get('/equipment/:id/pdf',  ctrl.equipmentPdf);
router.get('/alarms/xlsx',        ctrl.alarmsXlsx);
router.get('/summary/pdf',        ctrl.summaryPdf);

module.exports = router;
