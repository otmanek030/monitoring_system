'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/reportController');
const { authRequired, requirePerm } = require('../middleware/auth');

const router = Router();
router.use(authRequired);

// Per-user shift PDF needs only `my_shift:r` — an operator without the
// general `reports:r` right can still pull their own shift report.
router.get('/my-shift/pdf',       requirePerm('my_shift', 'r'), ctrl.myShiftPdf);

// Plant-wide / equipment-wide reports require reports:r
router.use(requirePerm('reports', 'r'));
router.get('/equipment/:id/xlsx', ctrl.equipmentXlsx);
router.get('/equipment/:id/pdf',  ctrl.equipmentPdf);
router.get('/alarms/xlsx',        ctrl.alarmsXlsx);
router.get('/summary/pdf',        ctrl.summaryPdf);

module.exports = router;
