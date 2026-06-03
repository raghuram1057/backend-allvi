require('dotenv').config();
const express = require('express');
const cors = require('cors');
const patientRoutes = require('./routes/patientRoutes');

const app = express();

// Set system communication options
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));

// Setup handling sizes limits dynamically across systems models layers
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Binding Route Segments directly into specialized path frameworks hooks
app.use('/api/patient', patientRoutes);

app.get('/', (req, res) => {
    res.status(200).send({ status: "online", service: "Allvi Compliance Core System Engine Platform APIs Engine Layer" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n=============================================================`);
    console.log(`🚀 ALLVI SECURE BACKEND SYSTEM INTERFACE LIVE ON PORT: ${PORT}`);
    console.log(`🔒 ARCHITECTURE ENVIRONMENT: MVC / PATIENT STRUCTURAL SCHEMA v1.0`);
    console.log(`=============================================================\n`);
});