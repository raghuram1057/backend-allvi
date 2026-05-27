require('dotenv').config();
const express = require('express');
const cors = require('cors');
const patientRoutes = require('./routes/patient');

const app = express();

// --- MIDDLEWARE SECTION ---

// 1. CORS should usually come first
app.use(cors({
    origin: '*', // During development, you can use '*' or 'http://localhost:5173'
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));

// 2. Body Parsers with increased limits
// IMPORTANT: We removed the plain app.use(express.json()) to prevent the 100kb default limit from triggering
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- ROUTES SECTION ---

// Routes must be defined AFTER the body parsers
app.use('/api/patient', patientRoutes);

// Health check
app.get('/', (req, res) => res.send('Allvi Server is Running!'));

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server is live at http://localhost:${PORT}`);
    console.log(`🚀 Also reachable at http://127.0.0.1:${PORT}`);
});