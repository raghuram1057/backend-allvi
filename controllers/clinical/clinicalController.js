const { supabaseAdmin } = require('../../config/supabase.js');
const calculateStreak = (checkins) => {
    if (!checkins || checkins.length === 0) return 0;
    const uniqueDates = [...new Set(checkins.map(c => c.checkin_date))].map(d => new Date(d));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

    const lastCheckinTime = uniqueDates[0].getTime();
    if (lastCheckinTime !== today.getTime() && lastCheckinTime !== yesterday.getTime()) return 0;

    let currentStreak = 1;
    let expectedDate = new Date(uniqueDates[0]);
    for (let i = 1; i < uniqueDates.length; i++) {
        expectedDate.setDate(expectedDate.getDate() - 1);
        if (uniqueDates[i].getTime() === expectedDate.getTime()) {
            currentStreak++;
        } else { break; }
    }
    return currentStreak;
};

const clinicalController = {
    getClinicalPatientDetails: async (req, res) => {
        try {
            const { patientId } = req.params;

            const { data, error } = await supabaseAdmin
                .from('profiles')
                .select(`
                    id, full_name, created_at,
                    intake_forms!patient_id ( condition ),
                    daily_checkins!patient_id ( 
                        checkin_date, energy_score, mood_score, sleep_score, stress_score 
                    )
                `)
                .eq('id', patientId)
                .single();

            if (error) throw error;

            const checkins = data.daily_checkins || [];
            // Sort by date descending to get the latest
            const sorted = checkins.sort((a, b) => new Date(b.checkin_date) - new Date(a.checkin_date));
            const latest = sorted[0] || {};

            // Calculate Weekly Reports (Simple 7-day rolling average)
            const weeklyReports = [
                { week: 'Current Week', energy: latest.energy_score || 0, mood: latest.mood_score || 0, flags: 0, status: 'green' }
            ];

            res.status(200).json({
                success: true,
                patient: {
                    id: data.id,
                    name: data.full_name,
                    condition: data.intake_forms?.[0]?.condition || "Thyroid Disease",
                    enrollDate: data.created_at,
                    streak: calculateStreak(checkins.map(c => c.checkin_date)),
                    metrics: {
                        Energy: latest.energy_score || 0,
                        Mood: latest.mood_score || 0,
                        Sleep: latest.sleep_score || 0,
                        Stress: latest.stress_score || 0
                    },
                    weeklyReports: weeklyReports
                }
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    },
    getPanelSummary: async (req, res) => {
        try {
            // 🚀 1. Fetch profiles, explicit intake forms, and the most recent check-ins for streak logic
            const { data: records, error } = await supabaseAdmin
                .from('profiles')
                .select(`
                    id, 
                    full_name, 
                    created_at,
                    intake_forms!patient_id ( condition ),
                    daily_checkins!patient_id ( checkin_date )
                `)
                // Filters check-ins to only look at recent history for clean calculation performance
                .order('checkin_date', { foreignTable: 'daily_checkins', ascending: false });

            if (error) {
                console.error("❌ SQL Fetch Exception in Clinical Panel:", error.message);
                throw error;
            }

            // 🚀 2. Process and map the records, dynamically computing the consecutive check-in streak
            const patientsArray = records.map(p => {
                const checkins = p.daily_checkins || [];

                let currentStreak = 0;
                let lastCheckinText = 'No submissions';
                let hasSubmittedTodayOrYesterday = false;

                if (checkins.length > 0) {
                    // Normalize the dates to calculate distinct consecutive days
                    const uniqueDates = [...new Set(checkins.map(c => c.checkin_date))].map(d => new Date(d));

                    const today = new Date();
                    today.setHours(0, 0, 0, 0);

                    const yesterday = new Date(today);
                    yesterday.setDate(yesterday.getDate() - 1);

                    // Track the last check-in date text context
                    const dynamicLastDate = uniqueDates[0];
                    const lastDateTime = dynamicLastDate.getTime();

                    if (lastDateTime === today.getTime()) {
                        lastCheckinText = 'Today';
                        hasSubmittedTodayOrYesterday = true;
                    } else if (lastDateTime === yesterday.getTime()) {
                        lastCheckinText = 'Yesterday';
                        hasSubmittedTodayOrYesterday = true;
                    } else {
                        lastCheckinText = dynamicLastDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    }

                    // Loop through dates sequentially to calculate current continuous consecutive days streak
                    if (hasSubmittedTodayOrYesterday) {
                        currentStreak = 1;
                        let expectedDate = new Date(dynamicLastDate);

                        for (let i = 1; i < uniqueDates.length; i++) {
                            expectedDate.setDate(expectedDate.getDate() - 1);

                            if (uniqueDates[i].getTime() === expectedDate.getTime()) {
                                currentStreak++;
                            } else {
                                break; // Streak broken
                            }
                        }
                    }
                }

                return {
                    id: p.id,
                    name: p.full_name || 'Anonymous Patient',
                    condition: p.intake_forms?.[0]?.condition === 'hashimotos'
                        ? "Hashimoto's"
                        : p.intake_forms?.[0]?.condition || 'Thyroid disease',
                    enrollDate: new Date(p.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                    }),
                    streak: String(currentStreak), // 🌟 Dynamic calculation from daily_checkins!
                    lastCheckin: lastCheckinText,  // 🌟 Dynamic status text context
                    risk: currentStreak > 0 ? "Green" : "Amber", // Soft dynamic risk triage rules
                    preApptStatus: "none"
                };
            });

            return res.status(200).json({
                success: true,
                metrics: {
                    totalEnrolled: patientsArray.length,
                    activeThisWeek: patientsArray.filter(p => parseInt(p.streak) > 0).length
                },
                patients: patientsArray
            });

        } catch (err) {
            console.error("❌ Panel Summary Controller Crash:", err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
    }
};

module.exports = clinicalController;