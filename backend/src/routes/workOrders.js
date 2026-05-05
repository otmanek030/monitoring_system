'use strict';

/**
 * Work-orders routes (auto-generated maintenance drafts).
 * Mounted at /api/work-orders.
 *
 *   GET    /                 - list drafts (filter ?status=, ?equipment_id=)
 *   GET    /:id              - get single draft
 *   GET    /pending/count    - lightweight badge endpoint
 *   POST   /                 - manual draft (technician+)
 *   POST   /auto-generate    - scan latest predictions and create drafts
 *   POST   /:id/approve      - convert draft into a real maintenance_orders row
 *   POST   /:id/reject       - mark draft as rejected
 */
const { Router } = require('express');
const ctrl = require('../controllers/workOrdersController');
const { authRequired, requirePerm } = require('../middleware/auth');

const router = Router();
router.use(authRequired);

router.get  ('/',                requirePerm('work_orders','r'), ctrl.list);
router.get  ('/pending/count',   requirePerm('work_orders','r'), ctrl.pendingCount);
router.get  ('/:id',             requirePerm('work_orders','r'), ctrl.get);

router.post ('/',                requirePerm('work_orders','w'), ctrl.create);
router.post ('/auto-generate',   requirePerm('work_orders','w'), ctrl.autoGenerate);
router.post ('/:id/approve',     requirePerm('work_orders','w'), ctrl.approve);
router.post ('/:id/reject',      requirePerm('work_orders','w'), ctrl.reject);

module.exports = router;
