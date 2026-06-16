const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin/adminController');

// 🚀 Platform-wide administration sync channel
router.get('/platform-overview', adminController.getPlatformOverview);
router.post('/organisations', adminController.createOrganisation);

module.exports = router;