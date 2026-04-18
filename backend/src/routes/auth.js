'use strict';

const { Router } = require('express');
const { login, me, changePassword } = require('../controllers/authController');
const { authRequired } = require('../middleware/auth');

const router = Router();

router.post('/login',            login);
router.get ('/me',               authRequired, me);
router.post('/change-password',  authRequired, changePassword);

module.exports = router;
