const express = require('express');
const nodemailer = require('nodemailer');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const bcrypt = require('bcrypt');

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require('@supabase/supabase-js');

const upload = multer({ storage: multer.memoryStorage() });

// 1. Initialize Clients
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 2. Initialize Gemini Model
const model = genAI.getGenerativeModel(
    { model: "gemini-3-flash-preview" },
    { apiVersion: "v1beta" }
);

const SALT_ROUNDS = 10;

// --- TALLY CONFIGURATION & MAPPING ---
const TALLY_API_KEY = process.env.TALLY_API_KEY;
const FORM_ID = 'zxYlVZ';

const TALLY_MAP = {
    NAME: "QA2rQg",
    EMAIL: "9dG1kG",
    GENDER: "aBNxL9",
    CITY: "7dlDAL",
    SYMPTOMS: "YZDOAd",
    GOALS: "42Xkbb",
    DOB: "WA9oWJ"
};

// Helper: Extract answer from Tally responses array
const getTallyAnswer = (responses, qid) => {
    const found = responses.find(r => r.questionId === qid);
    if (!found) return null;
    return Array.isArray(found.answer) ? found.answer[0] : found.answer;
};

// ─── UPGRADED SIGNUP / ACCOUNT ACTIVATION ENDPOINT ──────────────────────────
router.post('/activate', async (req, res) => {
    const emailInput = req.body.email ? req.body.email.toLowerCase().trim() : '';
    const passwordInput = req.body.password;

    if (!emailInput || !passwordInput) {
        return res.status(400).json({ success: false, message: "Missing required parameters for activation." });
    }

    try {
        // 1. Check if clinical team pre-enrolled the patient row via email marker
        const { data: existingPatient, error: fetchErr } = await supabase
            .from('patients')
            .select('*')
            .eq('email', emailInput)
            .maybeSingle();

        if (fetchErr) throw fetchErr;

        // Generate a localized tracking identity token string if no row pre-exists
        const allvi_id = existingPatient?.allvi_id || `ALLVI-${Math.floor(1000 + Math.random() * 9000)}`;
        const hashedPassword = await bcrypt.hash(passwordInput, SALT_ROUNDS);

        if (existingPatient) {
            console.log(`🔒 Initializing pre-enrolled patient password context: [${emailInput}]`);
            const { data: updatedPatient, error: updateErr } = await supabase
                .from('patients')
                .update({ password: hashedPassword })
                .eq('email', emailInput)
                .select('*')
                .single();

            if (updateErr) throw updateErr;

            // Remove password signature tracking block out of response payloads
            const cleanedProfile = { ...updatedPatient };
            delete cleanedProfile.password;

            return res.status(200).json({ success: true, allviId: allvi_id, patient: cleanedProfile });
        } else {
            console.log(`✨ Instantiating new baseline user authentication row context: [${emailInput}]`);
            const { data: newPatient, error: insertErr } = await supabase
                .from('patients')
                .insert([{
                    allvi_id: allvi_id,
                    email: emailInput,
                    password: hashedPassword,
                    name: 'Unknown',
                    gender: 'Prefer not to say' // ✅ FIX: Satisfies database constraint validation checklist limits
                }])
                .select('*')
                .single();

            if (insertErr) throw insertErr;

            const cleanedProfile = { ...newPatient };
            delete cleanedProfile.password;

            return res.status(200).json({ success: true, allviId: allvi_id, patient: cleanedProfile });
        }
    } catch (err) {
        console.error("❌ PATIENT SIGNUP ENROLLMENT SYSTEM ERROR:", err.message);
        res.status(500).json({ success: false, message: "Internal server registry allocation error." });
    }
});

// ─── UPGRADED LOGIN ROUTE: SUPPORTING INTERCHANGEABLE ALLVI ID OR EMAIL ─────
router.post('/login', async (req, res) => {
    // Collect the dynamic token variable fallback argument from backend body mapping layers
    const inputIdentifier = req.body.allviId || req.body.email;
    const cleanId = inputIdentifier ? inputIdentifier.trim() : '';
    const passwordInput = req.body.password;

    if (!cleanId || !passwordInput) {
        return res.status(400).json({ success: false, message: "Missing required login identifier parameters." });
    }

    console.log(`🔍 Querying authentication matching protocols for string value lookup: [${cleanId}]`);

    try {
        // Query to match either the case-insensitive email address column OR the standard Allvi ID token
        const { data: patient, error } = await supabase
            .from('patients')
            .select('*')
            .or(`email.ilike.%${cleanId}%,allvi_id.ilike.%${cleanId}%`)
            .maybeSingle();

        if (error) {
            console.error("❌ Supabase Database Error:", error.message);
            return res.status(500).json({ success: false, message: "Database connection mapping loop error." });
        }

        if (!patient) {
            console.log("⚠️ Identity tracking parameter match unreturned for text string input.");
            return res.status(401).json({ success: false, message: "Invalid combination or unactivated account." });
        }

        if (!patient.password) {
            return res.status(403).json({ success: false, message: "Profile unactivated. Complete account password tracking steps." });
        }

        // Validate the crypto hashed credentials context match matrix
        const isPasswordMatch = await bcrypt.compare(passwordInput, patient.password);
        if (!isPasswordMatch) {
            return res.status(401).json({ success: false, message: "Invalid combination matching parameters." });
        }

        console.log("✅ Credentials validation complete. Dispatching profile object data for:", patient.name);
        
        const outputProfile = { ...patient };
        delete outputProfile.password; // Strip database password context signatures

        res.status(200).json({ success: true, patient: outputProfile });

    } catch (err) {
        console.error("❌ SYSTEM LOGIN CRASH COMPILER LOGS:", err.message);
        res.status(500).json({ success: false, error: "Internal tracking registry engine login sequence crash." });
    }
});

// --- PROFILE UPDATE ROUTE ---
router.put('/profile/update/:allviId', async (req, res) => {
    const { allviId } = req.params;
    const { name, email, age, gender, city } = req.body;
    try {
        const { data, error } = await supabase
            .from('patients')
            .update({
                name,
                email,
                age: parseInt(age),
                gender,
                city
            })
            .eq('allvi_id', allviId)
            .select();

        if (error) throw error;
        res.status(200).json({ success: true, message: "Profile updated successfully", data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Helper Function to Validate Date
const isValidDate = (dateString) => {
    const regEx = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateString || !dateString.match(regEx)) return false;
    const d = new Date(dateString);
    return d instanceof Date && !isNaN(d.getTime());
};

// --- UPGRADED ROUTE: DIRECT FORM SUBMISSION + AI LAB EXTRACTION ---
// ─── UPGRADED ROUTE: SINGLE ROW PATIENT UPDATE INTAKE SUBMISSION ───────────
router.post('/submit-intake', upload.single('labReport'), async (req, res) => {
    try {
        const parseArray = (field) => {
            if (!field) return [];
            if (typeof field === 'string') {
                try { return JSON.parse(field); } catch (e) { return [field]; }
            }
            return Array.isArray(field) ? field : [field];
        };

        const formData = req.body;
        
        // CRITICAL FIX: Extract the ALLVI ID generated during the signup phase
        const existingAllviId = formData.allvi_id;

        if (!existingAllviId) {
            return res.status(400).json({ success: false, error: "Missing required ALLVI ID auth token identifier." });
        }

        console.log(`🚀 Updating existing account profile row for patient ID: [${existingAllviId}]`);

        let age = null;
        if (formData.dob) {
            const difference = Date.now() - new Date(formData.dob).getTime();
            age = Math.floor(difference / (1000 * 60 * 60 * 24 * 365.25));
        }

        // Validate gender selection string constraints explicitly to avoid CHECK constraint violations
        let safeGender = 'Prefer not to say'; 
        const allowedGenders = ['Female', 'Male', 'Non-binary', 'Prefer not to say', 'Prefer to self-describe'];
        if (allowedGenders.includes(formData.gender)) {
            safeGender = formData.gender;
        }

        // 1. UPDATE the existing user record row instead of running an entirely new .insert() loop
        const { error: patientErr } = await supabase
            .from('patients')
            .update({
                name: formData.fullName || 'Unknown',
                gender: safeGender,
                city: formData.location || null,
                age: age
            })
            .eq('allvi_id', existingAllviId);

        if (patientErr) {
            console.error("❌ Supabase Profile Row Update Anomaly Error:", patientErr.message);
            throw new Error(`Patient Update Error: ${patientErr.message}`);
        }

        // 2. Parse and save health markers down into the intake tables
        const allSymptoms = [
            ...parseArray(formData.symptomsEnergy), ...parseArray(formData.symptomsDigestion),
            ...parseArray(formData.symptomsMental), ...parseArray(formData.symptomsSleep), ...parseArray(formData.symptomsOther)
        ];
        if (formData.symptomsOtherText) allSymptoms.push(`Other: ${formData.symptomsOtherText}`);

        const allDiagnoses = [...parseArray(formData.conditions)];
        if (formData.conditionOther) allDiagnoses.push(`Other: ${formData.conditionOther}`);

        // Link intake metadata vectors directly to the exact same active ALLVI ID profile key
        const { error: intakeErr } = await supabase
            .from('patient_intake')
            .upsert([{
                patient_id: existingAllviId, 
                diagnoses: allDiagnoses, 
                symptoms: allSymptoms, 
                goals: formData.topGoals || null,
                stated_concern: (formData.topHelp || '') + (formData.anythingElse ? ` | Extra Notes: ${formData.anythingElse}` : '')
            }], { onConflict: 'patient_id' });

        if (intakeErr) console.error("⚠️ Intake database assignment log exception:", intakeErr.message);

        // ====================================================================
        // 3. AI LAB REPORT EXTRACTION PHASE (Maintained flawlessly)
        // ====================================================================
        let extractionSuccess = false;
        let parsedDataForReview = null;

        if (req.file) {
            console.log(`📄 Lab report detected. Sending to Gemini AI for extraction...`);
            
            const filePart = { inlineData: { data: req.file.buffer.toString("base64"), mimeType: req.file.mimetype } };
            const prompt = `
                ACT AS: A clinical data extraction engine.
                TASK: Extract every lab result from the provided document.
                REQUIRED JSON STRUCTURE:
                {
                  "test_date": "YYYY-MM-DD",
                  "biomarkers": {
                    "standardized_key": { "label": "Full Test Name", "value": 0.0, "unit": "string", "ref_range": "string" }
                  }
                }
                INSTRUCTIONS:
                1. "test_date": Locate the sample collection or report date.
                2. "standardized_key": short, lowercase_underscored name (e.g., "vit_b12").
                3. "label": Exact, formal test name.
                4. "value": Extract ONLY the number.
                5. "unit": Extract the measurement unit.
                6. "ref_range": Extract the reference interval.
                RULES: Identify EVERY marker. Return ONLY raw JSON. NO markdown.
            `;

            try {
                const result = await model.generateContent([prompt, filePart]);
                let aiText = result.response.text().replace(/```json/gi, '').replace(/```/g, '').trim();
                const extractedData = JSON.parse(aiText);

                const normalizedBiomarkers = {};
                if (extractedData.biomarkers) {
                    for (const [key, markerData] of Object.entries(extractedData.biomarkers)) {
                        const numericValue = parseFloat(markerData.value);
                        normalizedBiomarkers[key] = {
                            ...markerData,
                            value: isNaN(numericValue) ? markerData.value : numericValue
                        };
                    }
                }

                parsedDataForReview = {
                    test_date: extractedData.test_date || new Date().toISOString().split('T')[0],
                    biomarkers: normalizedBiomarkers
                };
                
                extractionSuccess = true;
                console.log(`✅ Lab data extracted and ready for Review screen!`);

            } catch (aiErr) {
                console.error("⚠️ AI Extraction failed.", aiErr.message);
            }
        }

        res.status(200).json({ 
            success: true, 
            allvi_id: existingAllviId, 
            extractedLabs: extractionSuccess,
            parsedData: parsedDataForReview,
            message: "Intake metadata successfully merged onto existing patient account row context!" 
        });

    } catch (err) {
        console.error("❌ SUBMIT INTAKE ERROR:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});
// --- ROUTE: PROCESS REPORT ---
router.post('/process-report', upload.single('report'), async (req, res) => {
    let finalAllviId = req.body.existingId;
    const userAge = req.body.age;
    const userGender = req.body.gender;
    const userMail = req.body.email;
    const userName = req.body.name;
    const userCity = req.body.city;

    try {
        if (!req.file) throw new Error("No file uploaded");

        const prompt = `
            ACT AS: A clinical data extraction engine.
            TASK: Extract every lab result from the provided document.

            REQUIRED JSON STRUCTURE:
            {
              "test_date": "YYYY-MM-DD",
              "biomarkers": {
                "standardized_key": {
                  "label": "Full Test Name",
                  "value": 0.0,
                  "unit": "string",
                  "ref_range": "string"
                }
              }
            }

            INSTRUCTIONS:
            1. "test_date": Locate the sample collection or report date.
            2. "standardized_key": Use a short, lowercase_underscored name (e.g., "vit_b12", "hba1c").
            3. "label": Extract the exact, formal test name as printed on the report (e.g., "Hemoglobin A1c").
            4. "value": Extract ONLY the number. If a value is "<0.1", return 0.1.
            5. "unit": Extract the measurement unit (e.g., "mg/dL", "uIU/mL").
            6. "ref_range": Extract the reference interval provided by the lab (e.g., "0.45 - 4.50").

            RULES:
            - Identify EVERY marker present on the page.
            - Return ONLY the raw JSON object.
            - NO markdown code blocks (no \`\`\`json).
            - NO conversational text or explanations.
        `;
        const result = await model.generateContent([
            prompt,
            { inlineData: { data: req.file.buffer.toString("base64"), mimeType: req.file.mimetype } }
        ]);

        const text = result.response.text();
        const cleanJson = text.replace(/```json|```/g, "").trim();
        let parsedData;
        try {
            parsedData = JSON.parse(cleanJson);
        } catch (e) {
            console.error("AI returned invalid JSON. Raw text:", text);
            throw new Error("Could not parse lab data. Please try a clearer photo.");
        }

        const isNewPatient = !finalAllviId || finalAllviId === "null" || finalAllviId === "undefined";

        if (isNewPatient) {
            finalAllviId = `ALLVI-${Math.floor(1000 + Math.random() * 9000)}`;
            
            let safeGenderFallback = 'Prefer not to say';
            const allowedGenders = ['Female', 'Male', 'Non-binary', 'Prefer not to say', 'Prefer to self-describe'];
            if (allowedGenders.includes(userGender)) {
                safeGenderFallback = userGender;
            }

            const { error: patientErr } = await supabase.from('patients').insert([{
                allvi_id: finalAllviId,
                age: userAge ? parseInt(userAge) : null,
                gender: safeGenderFallback,
                name: userName,
                city: userCity,
                email: userMail
            }]);
            if (patientErr) throw patientErr;
        }

        const responsePayload = {
            test_date: parsedData.test_date || new Date().toISOString().split('T')[0],
            biomarkers: parsedData.biomarkers || {}
        };

        console.log("✅ Extracted Markers:", Object.keys(responsePayload.biomarkers));

        res.status(200).json({
            success: true,
            allvi_id: finalAllviId,
            parsedData: responsePayload
        });

    } catch (err) {
        console.error("❌ PROCESS ERROR:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- ROUTE: CONFIRM RESULTS ---
router.post('/confirm-results', async (req, res) => {
    try {
        const { patientId, test_date, biomarkers } = req.body;
        const { error } = await supabase.from('lab_results').insert([{
            patient_id: patientId,
            test_date: test_date || new Date().toISOString().split('T')[0],
            data: biomarkers
        }]);

        if (error) throw error;
        res.status(200).json({ success: true });
    } catch (err) {
        console.error("❌ CONFIRM ERROR:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- GET DASHBOARD DATA ---
router.get('/dashboard/:patientId', async (req, res) => {
    try {
        const { patientId } = req.params;
        const { data: patient } = await supabase.from('patients').select('*').eq('allvi_id', patientId).maybeSingle();
        const { data: intakeData } = await supabase.from('patient_intake').select('*').eq('patient_id', patientId).order('updated_at', { ascending: false }).limit(1);
        const { data: labs } = await supabase.from('lab_results').select('id, test_date, data, report_type').eq('patient_id', patientId).order('test_date', { ascending: true });
        const { data: symptoms } = await supabase.from('symptoms').select('*').eq('patient_id', patientId).order('date', { ascending: true });
        const { data: reviews } = await supabase.from('specialist_reviews').select('*').eq('patient_id', patientId).order('sent_at', { ascending: false });

        const formattedLabs = (labs || []).map(row => {
            const transformedRow = { id: row.id, test_date: row.test_date, meta: {} };
            if (row.data) {
                Object.entries(row.data).forEach(([key, info]) => {
                    const val = parseFloat(info.value);
                    transformedRow[key] = isNaN(val) ? 0 : val;
                    transformedRow.meta[key] = { label: info.label || key, unit: info.unit || '', ref_range: info.ref_range || '' };
                });
            }
            return transformedRow;
        });

        res.status(200).json({
            success: true,
            profile: { ...patient, allvi_id: patientId },
            intake: intakeData ? intakeData[0] : {},
            labs: formattedLabs,
            symptoms: symptoms || [],
            specialistReviews: reviews || []
        });
    } catch (err) { res.status(500).json({ success: false, details: err.message }); }
});

// ─── GENERATE AI INSIGHTS ───
router.get('/insights/:patientId', async (req, res) => {
    try {
        const { patientId } = req.params;
        
        const { data: labs } = await supabase.from('lab_results').select('*').eq('patient_id', patientId).order('test_date', { ascending: true });
        const { data: symptoms } = await supabase.from('symptoms').select('*').eq('patient_id', patientId).order('date', { ascending: true });
        const { data: intake } = await supabase.from('patient_intake').select('*').eq('patient_id', patientId).order('updated_at', { ascending: false }).limit(1);

        if (!labs || labs.length === 0) {
            return res.json({ success: true, insights: "Not enough data mapped to generate insights yet." });
        }

        const dataSummary = `
            Patient Lab History: ${JSON.stringify(labs)}
            Patient Symptom History: ${JSON.stringify(symptoms)}
            Patient Intake Form: ${JSON.stringify(intake)}
        `;

        const prompt = `You are a clinical data analyst. Analyze this patient's health data (including their intake goals, symptoms, and lab results). Provide a structured summary in three sections: POSITIVE TRENDS, AREAS OF CONCERN, and NEEDS ATTENTION. Keep it clinically precise.`;

        const result = await model.generateContent([prompt, dataSummary]);
        res.status(200).json({ success: true, insights: result.response.text() });
    } catch (err) { 
        console.error("AI Insights Error:", err.message);
        res.status(500).json({ success: false, error: err.message }); 
    }
});

router.get('/admin/patients', async (req, res) => {
    try {
        const { data: patients, error } = await supabase
            .from('patients')
            .select(`
                allvi_id,
                created_at,
                lab_results (test_date)
            `);
        if (error) throw error;
        const formattedPatients = patients.map(p => ({
            id: p.allvi_id,
            joined: p.created_at,
            lastActivity: p.lab_results?.length > 0
                ? p.lab_results.sort((a, b) => new Date(b.test_date) - new Date(a.test_date))[0].test_date
                : 'No reports yet'
        }));
        res.status(200).json({ success: true, patients: formattedPatients });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/admin/patients/:patientId', async (req, res) => {
    try {
        const { error } = await supabase.from('patients').delete().eq('allvi_id', req.params.patientId);
        if (error) throw error;
        res.status(200).json({ success: true, message: "Deleted" });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/import-symptoms', async (req, res) => {
    try {
        const { patientId, symptoms } = req.body;
        
        const symptomRows = symptoms.map(row => ({
            patient_id: patientId, 
            date: row.date || new Date().toISOString().split('T')[0],
            energy: parseInt(row.energy) || 0,
            sleep: parseInt(row.sleep) || 0,
            mood: parseInt(row.mood) || 0,
            stress: parseInt(row.stress) || 0,
            joint_pain: parseInt(row.joint_pain) || 0
        }));

        const { error } = await supabase
            .from('symptoms')
            .upsert(symptomRows, { 
                onConflict: 'patient_id,date' 
            });

        if (error) throw error;
        res.status(200).json({ success: true, message: "Data synced successfully" });
    } catch (err) { 
        res.status(500).json({ success: false, error: err.message }); 
    }
});

router.post('/request-appointment', async (req, res) => {
    try {
        const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
        await transporter.sendMail({ from: process.env.EMAIL_USER, to: 'support@allvihealth.com', subject: `Appointment: ${req.body.patientId}`, text: req.body.notes });
        res.status(200).json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// --- SYNC PAST TALLY DATA ROUTE ---
router.get('/sync-past-tally', async (req, res) => {
    try {
        const response = await axios.get(`https://api.tally.so/forms/${FORM_ID}/submissions`, {
            headers: { 'Authorization': `Bearer ${TALLY_API_KEY}` }
        });

        const submissions = response.data.submissions;
        if (!submissions?.length) {
            return res.status(200).json({ success: true, message: "No submissions found." });
        }

        let synced = 0;
        let skipped = 0;
        const errors = [];

        for (const sub of submissions) {
            const resps = sub.responses;

            const email = getTallyAnswer(resps, TALLY_MAP.EMAIL);
            const name  = getTallyAnswer(resps, TALLY_MAP.NAME);
            const city  = getTallyAnswer(resps, TALLY_MAP.CITY);
            const symptoms = getTallyAnswer(resps, TALLY_MAP.SYMPTOMS);
            const goals    = getTallyAnswer(resps, TALLY_MAP.GOALS);

            let gender = getTallyAnswer(resps, TALLY_MAP.GENDER);
            if (Array.isArray(gender)) gender = gender[0];

            const validGenders = ['Male', 'Female', 'Other'];
            const safeGender = validGenders.includes(gender) ? gender : null;

            if (!email) {
                skipped++;
                continue;
            }

            const allvi_id = `ALLVI-${Math.floor(1000 + Math.random() * 9000)}`;

            const { data: patientData, error: pError } = await supabase
                .from('patients')
                .upsert([{
                    allvi_id,
                    name:   name  || 'Unknown',
                    email:  email.toLowerCase().trim(),
                    gender: safeGender,
                    city:   city  || null,
                    created_at: sub.createdAt
                }], { onConflict: 'email' })
                .select('allvi_id')
                .single();

            if (pError) {
                errors.push({ email, error: pError.message });
                continue;
            }

            const actualAllviId = patientData.allvi_id;
            const symptomsArray = Array.isArray(symptoms) ? symptoms : (symptoms ? [symptoms] : []);

            const { error: intakeError } = await supabase
                .from('patient_intake')
                .insert([{
                    patient_id: actualAllviId,
                    symptoms:   symptomsArray,
                    goals:      goals || null,
                }]);

            synced++;
        }

        res.status(200).json({
            success: true,
            message: `Synced ${synced}, skipped ${skipped}`,
            errors: errors.length ? errors : undefined
        });

    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/debug-tally', async (req, res) => {
    try {
        const response = await axios.get(`https://api.tally.so/forms/${FORM_ID}/submissions`, {
            headers: { 'Authorization': `Bearer ${TALLY_API_KEY}` }
        });

        const firstSub = response.data.submissions?.[0];
        if (!firstSub) return res.json({ message: "No submissions" });

        const questionMap = firstSub.responses.map(r => ({
            questionId: r.questionId,
            answer: r.answer
        }));

        res.json({ questionMap });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- SAVE SPECIALIST PROTOCOL & NOTES ---
router.post('/admin/send-protocol', upload.single('protocolFile'), async (req, res) => {
    try {
        const { patientId, notes, summary, nextStep, specialistName } = req.body;
        let attachmentUrl = null;

        if (req.file) {
            const fileName = `${patientId}_${Date.now()}_${req.file.originalname.replace(/\s+/g, '_')}`;
            const { data, error: uploadErr } = await supabase.storage
                .from('protocols')
                .upload(fileName, req.file.buffer, { contentType: req.file.mimetype });

            if (uploadErr) {
                console.error("Storage upload error:", uploadErr.message);
            } else {
                const { data: publicUrlData } = supabase.storage.from('protocols').getPublicUrl(fileName);
                attachmentUrl = publicUrlData.publicUrl;
            }
        }

        const combinedMessage = summary && summary !== 'null' 
            ? `${notes}\n\n=== AI SUMMARY REFERENCE ===\n${summary}`
            : notes;

        const { error } = await supabase.from('specialist_reviews').insert([{
            patient_id: patientId,
            message_text: combinedMessage,
            reviewed_by: specialistName || 'Allvi Clinical Specialist',
            next_step: nextStep || 'Follow up in 2 weeks',
            protocol_attachment_url: attachmentUrl,
            sent_at: new Date().toISOString()
        }]);

        if (error) throw error;
        res.status(200).json({ success: true, message: "Protocol sent to patient successfully!" });
    } catch (err) {
        console.error("❌ SEND PROTOCOL ERROR:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;