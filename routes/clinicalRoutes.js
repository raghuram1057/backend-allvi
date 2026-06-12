// 📋 server/routes/clinicalRoutes.js
const express = require('express');
const router = express.Router();
const clinicalController = require('../controllers/clinical/clinicalController.js');
const authController = require('../controllers/authController');


router.post('/clinical-login', authController.clinicalLogin);

// 🚀 Clean MVC Route Binding Layout (No Auth middleware appended for development)
router.get('/panel-summary', clinicalController.getPanelSummary);
router.get('/patient-details/:patientId', clinicalController.getClinicalPatientDetails);
router.get('/force-sync', authController.forceSyncClinician);

module.exports = router;