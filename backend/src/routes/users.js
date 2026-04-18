'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/userController');
const { authRequired, requireRole } = require('../middleware/auth');

const router = Router();
router.use(authRequired, requireRole('admin'));

router.get   ('/',            ctrl.list);
router.post  ('/',            ctrl.create);
router.patch ('/:id/active',  ctrl.setActive);
router.patch ('/:id/role',    ctrl.setRole);
router.delete('/:id',         ctrl.remove);

module.exports = router;
