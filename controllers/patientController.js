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
            console.log("DB_CHECK:", { pErr, iErr, lErr, sErr, mErr });
            console.log("LAB_ROWS_RECEIVED:", labRows);

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

            // 3. Handle JSONB flattening for Intake
            const intake = intakeData && intakeData.length > 0 ? intakeData[0] : {};
            const normalizedIntake = {
                ...intake,
                diagnoses: intake.condition_data?.diagnoses || intake.primary_symptoms || [],
                symptoms: intake.condition_data?.symptoms || intake.primary_symptoms || [],
                goals: intake.goals_free_text || intake.goals || ""
            };

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
                specialistReviews: reviews || []
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    }
};
module.exports = patientController;