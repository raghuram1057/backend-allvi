const { supabaseAdmin } = require('../config/supabase');
const aiService = require('../services/AIService');

//named
const calculateCurrentStreak = (checkinDates) => {
    if (!checkinDates || checkinDates.length === 0) return 0;

    // Sort dates descending (newest first) and remove duplicates
    const sortedDates = [...new Set(checkinDates)]
        .sort((a, b) => new Date(b) - new Date(a));

    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // If latest checkin isn't today or yesterday, streak is 0
    if (sortedDates[0] !== today && sortedDates[0] !== yesterdayStr) {
        return 0;
    }

    let streak = 0;
    let lastDate = new Date(sortedDates[0]);

    for (let i = 0; i < sortedDates.length; i++) {
        let currentDate = new Date(sortedDates[i]);
        let diffDays = Math.round((lastDate - currentDate) / (1000 * 60 * 60 * 24));

        if (diffDays <= 1) {
            if (i === 0 || diffDays === 1) streak++;
            lastDate = currentDate;
        } else {
            break;
        }
    }
    return streak;
};

const patientController = {
    getDynamicProtocolManifest: async (req, res) => {
        try {
            const { patientId } = req.params;
            const targetUuid = patientId && patientId !== 'undefined' ? patientId : req.user?.id;

            if (!targetUuid) {
                return res.status(400).json({ success: false, error: "Patient context ID missing from session query loops." });
            }

            // Fetch live profiles and intake context elements concurrently
            const [
                { data: profile },
                { data: intakeRows },
                { data: labRows },
                { data: checkinRows }
            ] = await Promise.all([
                supabaseAdmin.from('profiles').select('*').eq('id', targetUuid).maybeSingle(),
                supabaseAdmin.from('intake_forms').select('*').eq('patient_id', targetUuid).order('created_at', { ascending: false }).limit(1),
                supabaseAdmin.from('lab_results').select('*').eq('patient_id', targetUuid).order('sampled_at', { ascending: false }),
                supabaseAdmin.from('daily_checkins').select('*').eq('patient_id', targetUuid).order('checkin_date', { ascending: false })
            ]);

            const intake = intakeRows?.[0] || {};
            
            // 🚀 1. DIRECT DATABASE RENDER FIELDS (STRICT INTAKE-FORM COLUMN MAPPING)
            // Extract the exact diagnosis array token out of the condition_data JSON block
            const finalDiagnosis = intake.condition_data?.diagnoses?.[0] || intake.diagnoses?.[0] || "Hashimoto's Thyroiditis";
            
            // Pull initial tracking symptoms logged at baseline
            const finalSymptoms = intake.condition_data?.symptoms || intake.primary_symptoms || [];
            
            // ✅ Read the exact patient primary goals string straight out of free_text_goal / goals_free_text
            const finalGoals = intake.free_text_goal || intake.goals_free_text || intake.goals || "";

            // Gather active supplements list from database to feed the AI prompt template
            const baselineSupplements = intake.supplements_baseline || intake.condition_data?.supplements || [];
            const checkinSupplements = (checkinRows || []).slice(0, 14).flatMap(c => c.supplements_taken || []);
            const uniqueSupplements = Array.from(
                new Set([...baselineSupplements, ...checkinSupplements].map(s => s?.trim()).filter(Boolean))
            );

            // 🚀 2. CALL GENERATIVE ENGINE FOR COMPREHENSIVE AI TAB GENERATION
            // Passing down live database parameters prevents the generation of generic or hallucinated guidelines
            const aiProtocol = await aiService.generateComprehensiveProtocol(
                labRows || [], 
                checkinRows || [], 
                intake, 
                profile || {},
                uniqueSupplements
            );

            if (!aiProtocol) {
                return res.status(500).json({ success: false, error: "AI failed to build protocol matrix models." });
            }

            // Return direct database tokens + dynamic generative matrices instantly to your frontend state loops
            return res.status(200).json({
                success: true,
                diagnosis: finalDiagnosis,
                symptoms: finalSymptoms,
                goals: finalGoals, // Sent directly to the dark teal layout panel header card
                protocol: aiProtocol 
            });

        } catch (err) {
            console.error("❌ Protocol Engine Master Fault:", err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },
    getAdvocacyDocData: async (req, res) => {
        try {
            const { patientId } = req.params;
            const targetUuid = patientId || req.user.id;

            // 1. Fetch raw patient contexts from Supabase concurrently
            const [
                { data: labRows, error: lErr },
                { data: checkins, error: cErr },
                { data: intakeRows, error: iErr }
            ] = await Promise.all([
                supabaseAdmin.from('lab_results').select('*').eq('patient_id', targetUuid).order('sampled_at', { ascending: true }),
                supabaseAdmin.from('daily_checkins').select('*').eq('patient_id', targetUuid).order('checkin_date', { ascending: true }),
                supabaseAdmin.from('intake_forms').select('*').eq('patient_id', targetUuid).order('created_at', { ascending: false }).limit(1)
            ]);

            if (lErr || cErr || iErr) throw new Error("Database query execution pipeline exception.");

            // 2. Pivot lab results for the timeline view matrix component
            const labsByDate = {};
            if (labRows && labRows.length > 0) {
                labRows.forEach(row => {
                    const date = row.sampled_at;
                    if (!labsByDate[date]) labsByDate[date] = { test_date: date, meta: {} };

                    const safeKey = row.display_name.toLowerCase().replace(/[^a-z0-9]/g, '_');
                    labsByDate[date][safeKey] = row.value_quantity;
                    labsByDate[date].meta[safeKey] = {
                        label: row.display_name,
                        unit: row.value_unit,
                        ref_range: `${row.reference_range_low}-${row.reference_range_high}`
                    };
                });
            }

            // 3. Generate dynamic clinical questions using our AI service block
            const aiGeneratedQuestions = await aiService.generateAdvocacyQuestions(
                labRows || [],
                checkins || [],
                intakeRows?.[0] || {}
            );

            // 4. Return everything directly down the pipe
            return res.status(200).json({
                success: true,
                labs: Object.values(labsByDate),
                questions: aiGeneratedQuestions // ✅ Sent down to frontend cleanly!
            });

        } catch (err) {
            console.error("❌ Advocacy Document Pipeline Error:", err.message);
            return res.status(500).json({ success: false, error: "Internal query compiling error." });
        }
    },

    getWeeklyReport: async (req, res) => {
        try {
            const { patientId } = req.params;
            const targetUuid = patientId || req.user.id;

            const [
                { data: labRows },
                { data: checkins },
                { data: intakeRows }
            ] = await Promise.all([
                supabaseAdmin.from('lab_results').select('*').eq('patient_id', targetUuid).order('sampled_at', { ascending: true }),
                supabaseAdmin.from('daily_checkins').select('*').eq('patient_id', targetUuid).order('checkin_date', { ascending: true }),
                supabaseAdmin.from('intake_forms').select('*').eq('patient_id', targetUuid).order('created_at', { ascending: false }).limit(1)
            ]);

            const aiGeneratedPayload = await aiService.generateWeeklyMonitoringFeed(
                labRows || [],
                checkins || [],
                intakeRows?.[0] || {}
            );

            return res.status(200).json({
                success: true,
                clinical_monitoring: aiGeneratedPayload.clinical_monitoring || [],
                weekly_patterns: aiGeneratedPayload.weekly_patterns || [],
                whats_next: aiGeneratedPayload.whats_next || [] // ✅ Sent down to frontend state smoothly
            });

        } catch (err) {
            console.error("❌ Weekly Report Router Error:", err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
    },
    getInsights: async (req, res) => {
        try {
            const { patientId } = req.params;

            // 1. Fetch data from models
            const [
                { data: labs },
                { data: symptoms },
                { data: intake }
            ] = await Promise.all([
                supabaseAdmin.from('lab_results').select('*').eq('patient_id', patientId).order('sampled_at', { ascending: true }),
                supabaseAdmin.from('daily_checkins').select('*').eq('patient_id', patientId).order('checkin_date', { ascending: true }),
                supabaseAdmin.from('intake_forms').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }).limit(1)
            ]);

            if (!labs || labs.length === 0) {
                return res.json({ success: true, insights: "Not enough data mapped to generate insights yet." });
            }

            // 2. Call the AI service
            const insights = await aiService.generatePatientInsights(labs, symptoms, intake);

            res.status(200).json({ success: true, insights });
        } catch (err) {
            console.error("AI Insights Error:", err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    },

    getDashboardData: async (req, res) => {
        try {
            const { patientId } = req.params;
            const targetUuid = patientId || req.user.id;

            // 1. Fetch data with explicit logging to see which table is returning empty
            const [
                { data: patient, error: pErr },
                { data: intakeData, error: iErr },
                { data: labRows, error: lErr },
                { data: symptoms, error: sErr },
                { data: reviews, error: mErr }
            ] = await Promise.all([
                supabaseAdmin.from('profiles').select('*').eq('id', targetUuid).maybeSingle(),
                supabaseAdmin.from('intake_forms').select('*').eq('patient_id', targetUuid).order('created_at', { ascending: false }).limit(1),
                supabaseAdmin.from('lab_results').select('*').eq('patient_id', targetUuid).order('sampled_at', { ascending: true }),
                supabaseAdmin.from('daily_checkins').select('*').eq('patient_id', targetUuid).order('checkin_date', { ascending: true }),
                supabaseAdmin.from('messages').select('*').eq('patient_id', targetUuid).order('created_at', { ascending: false })
            ]);


            const checkinDates = (symptoms || []).map(s => s.checkin_date);
            const currentStreak = calculateCurrentStreak(checkinDates);
            // DEBUGGING LOGS
            //console.log("DB_CHECK:", { pErr, iErr, lErr, sErr, mErr });
            //console.log("LAB_ROWS_RECEIVED:", labRows);

            // 2. Pivot Logic (Same as before)
            const labsByDate = {};
            if (labRows && labRows.length > 0) {
                labRows.forEach(row => {
                    const date = row.sampled_at;
                    if (!labsByDate[date]) labsByDate[date] = { test_date: date, meta: {} };

                    const safeKey = row.display_name.toLowerCase().replace(/[^a-z0-9]/g, '_');
                    labsByDate[date][safeKey] = row.value_quantity;
                    labsByDate[date].meta[safeKey] = {
                        label: row.display_name,
                        unit: row.value_unit,
                        ref_range: `${row.reference_range_low}-${row.reference_range_high}`
                    };
                });
            }

            //console.log("re",labRows)

            // 3. Handle JSONB flattening for Intake
            const intake = intakeData && intakeData.length > 0 ? intakeData[0] : {};
            const normalizedIntake = {
                ...intake,
                diagnoses: intake.condition_data?.diagnoses || intake.primary_symptoms || [],
                symptoms: intake.condition_data?.symptoms || intake.primary_symptoms || [],
                goals: intake.goals_free_text || intake.goals || ""
            };
            let dynamicWhatsNextArray = [];
            if (labRows && labRows.length > 0) {
                // Generate using the updated class method we built in your AIService
                const aiResponsePayload = await aiService.generateWeeklyMonitoringFeed(labRows || [], symptoms || [], intake);
                dynamicWhatsNextArray = aiResponsePayload?.whats_next || [];
            }




            res.status(200).json({
                success: true,
                profile: patient,
                intake: normalizedIntake,
                labs: Object.values(labsByDate),
                symptoms: (symptoms || []).map(s => ({
                    energy: s.energy_score,
                    mood: s.mood_score,
                    sleep: s.sleep_score,
                    stress: s.stress_score,
                    date: s.checkin_date
                })),
                streak: currentStreak,
                specialistReviews: reviews || [],
                whats_next: dynamicWhatsNextArray
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    }


};
module.exports = patientController;