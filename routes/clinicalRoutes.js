// 📋 server/routes/clinicalRoutes.js
const express = require('express');
const router = express.Router();
const clinicalController = require('../controllers/clinical/clinicalController.js');

// 🚀 Clean MVC Route Binding Layout (No Auth middleware appended for development)
router.get('/panel-summary', clinicalController.getPanelSummary);
router.get('/patient-details/:patientId', clinicalController.getClinicalPatientDetails);

module.exports = router;