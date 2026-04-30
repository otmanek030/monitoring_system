'use strict';

/**
 * Direct messages — REST + simple polling endpoints used by the floating
 * Communication panel and the alarm-notifier service.
 */
const { Router } = require('express');
const ctrl = require('../controllers/messagesController');
const { authRequired } = require('../middleware/auth');

const router = Router();
router.use(authRequired);

router.get  ('/threads',  ctrl.threads);
router.get  ('/unread',   ctrl.unreadCount);
router.get  ('/',         ctrl.list);     // ?with=USER_ID for a thread
router.post ('/',         ctrl.send);
router.patch('/read',     ctrl.markRead);

module.exports = router;
