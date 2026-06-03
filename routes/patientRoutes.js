const express = require('express');
const router = express.Router();
const multer = require('multer');

// Controller Definitions Import Loops
const authController = require('../controllers/authController');
const healthController = require('../controllers/healthController');
const syncController = require('../controllers/syncController');

// Guard Middlewares Imports Definitions
const requireAuth = require('../middlewares/authMiddleware');

const upload = multer({ storage: multer.memoryStorage() });

// Public Identity Authentication Access Routes
router.post('/enroll', authController.enrollPatient);
router.post('/activate', authController.activateAccount);
router.post('/login', authController.login);

// Guarded Protected Clinical Information Workflow Vectors
router.post('/checkin', requireAuth, healthController.submitDailyCheckin);
router.post('/labs/upload', requireAuth, upload.single('labReport'), healthController.uploadLabReport);
router.post(
    '/submit-intake',
    requireAuth,
    upload.single('labReport'), // 🚀 Captures the 'labReport' multi-part file binary data streams
    healthController.submitOnboardingIntake
);
router.post('/labs/confirm', requireAuth, healthController.confirmLabResults);

// Synchronization Tasks Control Matrix Enforcements
router.get('/sync/tally', requireAuth, syncController.syncPastTallySubmissions);

module.exports = router;