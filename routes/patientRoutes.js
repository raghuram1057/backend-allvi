const express = require('express');
const router = express.Router();
const multer = require('multer');

// Controller Definitions Import Loops
const authController = require('../controllers/authController');
const healthController = require('../controllers/healthController');
const patientController = require('../controllers/patientController');
const syncController = require('../controllers/syncController');
const appointmentController = require('../controllers/appointmentController.js');

// Guard Middlewares Imports Definitions
const requireAuth = require('../middlewares/authMiddleware');

const upload = multer({ storage: multer.memoryStorage() });

// Public Identity Authentication Access Routes
router.post('/enroll', authController.enrollPatient);
router.post('/activate', authController.activateAccount);
router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);
router.post('/verify', authController.verifyUser); 
router.post('/update-password', authController.updatePassword);
// Guarded Protected Clinical Information Workflow Vectors
router.post('/checkin', requireAuth, healthController.submitDailyCheckin);
router.post('/labs/upload', requireAuth, upload.single('file'), healthController.uploadLabReport);
router.post(
    '/submit-intake',
    requireAuth,
    upload.single('labReport'), // 🚀 Captures the 'labReport' multi-part file binary data streams
    healthController.submitOnboardingIntake
);
router.post('/confirm-results', requireAuth, healthController.confirmLabResults);

// Synchronization Tasks Control Matrix Enforcements
router.get('/sync/tally', requireAuth, syncController.syncPastTallySubmissions);

router.get('/dashboard/:patientId', requireAuth, patientController.getDashboardData);
router.get('/insights/:patientId', requireAuth, patientController.getInsights);
router.get('/weekly-report/:patientId', requireAuth, patientController.getWeeklyReport);
// Mount the dynamic advocacy data retrieval tunnel matching the frontend axios parameters
router.get('/advocacy-doc/:patientId',requireAuth , patientController.getAdvocacyDocData);
// Route configuration for fetching structured patient data lists
router.get('/protocol-comprehensive/:patientId', patientController.getDynamicProtocolManifest);

//appointcontroller

router.post('/request-appointment/:patientId', requireAuth, appointmentController.requestAppointment);

module.exports = router;