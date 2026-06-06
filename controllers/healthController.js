const { supabase, supabaseAdmin } = require('../config/supabase');
const aiService = require('../services/AIService');
const logService = require('../services/logService');

const HealthController = {
    /**
     * Processes new dynamic patient lifecycle metrics safely inside the daily_checkins core structure.
     */
    submitDailyCheckin: async (req, res) => {
        try {
            const {
                energy_score, mood_score, sleep_score, stress_score,
                diet_compliance, symptoms_reported, condition_data, free_text
            } = req.body;

            const patientId = req.user.id; // Retrieved directly via auth token mapping definitions
            const checkinDate = new Date().toISOString().split('T')[0];

            const { data, error } = await supabaseAdmin
                .from('daily_checkins')
                .upsert([{
                    patient_id: patientId,
                    checkin_date: checkinDate,
                    energy_score: parseInt(energy_score),
                    mood_score: parseInt(mood_score),
                    sleep_score: parseInt(sleep_score),
                    stress_score: parseInt(stress_score),
                    diet_compliance: diet_compliance,
                    symptoms_reported: symptoms_reported || [],
                    condition_data: condition_data || {},
                    free_text: free_text || null
                }], { onConflict: 'patient_id, checkin_date' })
                .select('*')
                .single();

            if (error) throw error;

            await logService.write({
                req: req,
                action: 'checkin.submitted',
                resourceType: 'daily_checkins',
                resourceId: data.id,
                patientId: patientId,
                newValues: data
            });

            return res.status(200).json({ success: true, data });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * AI Extraction Endpoint for standalone incoming laboratory files mapping loops.
     */
    uploadLabReport: async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ success: false, error: "Missing file." });
            const patientId = req.user.id;

            // 1. Sanitize file meta for storage
            const cleanFileName = req.file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
            const storagePath = `lab-uploads/${patientId}/${Date.now()}_${cleanFileName}`;
            const fileTypeExtension = req.file.mimetype.split('/')[1] || 'pdf';

            // 2. Transaction A: Storage Upload
            const { error: storageErr } = await supabaseAdmin.storage
                .from('lab-uploads')
                .upload(storagePath, req.file.buffer, {
                    contentType: req.file.mimetype,
                    cacheControl: '3600'
                });
            if (storageErr) throw storageErr;

            // 3. Transaction B: Log into 'lab_uploads' with Rollback Protection
            const { data: uploadRecord, error: uploadDbErr } = await supabaseAdmin
                .from('lab_uploads')
                .insert([{
                    patient_id: patientId,
                    storage_path: storagePath,
                    file_name: req.file.originalname,
                    file_type: ['pdf', 'jpeg', 'png'].includes(fileTypeExtension) ? fileTypeExtension : 'pdf',
                    file_size_bytes: req.file.size,
                    upload_status: 'virus_scanned'
                }])
                .select('id')
                .single();

            if (uploadDbErr) {
                await supabaseAdmin.storage.from('lab-uploads').remove([storagePath]);
                throw uploadDbErr;
            }

            // 4. AI Extraction
            let aiParsedData = null;
            try {
                aiParsedData = await aiService.extractLabReport(req.file.buffer, req.file.mimetype);
            } catch (aiErr) {
                console.error("AI Extraction skipped, saving file record only:", aiErr.message);
            }

            // 5. Transaction C: Bulk Insert to 'lab_results'
            if (aiParsedData?.biomarkers) {
                const labEntries = Object.entries(aiParsedData.biomarkers).map(([key, info]) => {
                    const parsedValue = parseFloat(info.value);
                    const low = parseFloat(info.reference_range_low);
                    const high = parseFloat(info.reference_range_high);

                    return {
                        patient_id: patientId,
                        lab_upload_id: uploadRecord.id, // Linking to the tracking table record
                        sampled_at: aiParsedData.test_date || new Date().toISOString().split('T')[0],
                        display_name: info.label || key.toUpperCase().replace(/_/g, ' '),
                        value_quantity: !isNaN(parsedValue) ? parsedValue : null,
                        value_unit: info.unit || null,
                        reference_range_low: !isNaN(low) ? low : null,
                        reference_range_high: !isNaN(high) ? high : null,
                        interpretation: ['normal', 'low', 'high'].includes(info.interpretation) ? info.interpretation : 'normal',
                        allvi_status: ['green', 'amber', 'red'].includes(info.allvi_status) ? info.allvi_status : 'green',
                        fhir_resource_type: 'Observation',
                        fhir_status: 'final',
                        entry_method: 'upload_parsed',
                        clinician_verified: false
                    };
                });

                await supabaseAdmin.from('lab_results').insert(labEntries);
            }

            // 6. Return success to UI
            return res.status(200).json({
                success: true,
                uploadTrackId: uploadRecord.id,
                parsedData: aiParsedData
            });

        } catch (err) {
            console.error("❌ UPLOAD PIPELINE CRASH:", err);
            return res.status(500).json({ success: false, error: err.message });
        }
    },

    /**
     * Saves verified extracted results down straight to the lab_results schema matrix structure.
     */
    confirmLabResults: async (req, res) => {
        try {
            // 1. Grab the payload from Phase1Review.jsx
            const { test_date, biomarkers, lab_upload_id } = req.body;
            console.log("📥 Incoming Review Payload:", req.body);
            console.log(biomarkers)

            const patientId = req.user?.id || req.body.patientId;

            if (!biomarkers || Object.keys(biomarkers).length === 0) {
                return res.status(400).json({ success: false, error: "No biomarkers provided to save." });
            }

            // 2. Map the frontend data safely without destroying zeros or bounds
            const rowsToInsert = Object.entries(biomarkers).map(([key, info]) => {

                // FIX 1: Safely parse numbers so '0' doesn't become 'null'
                const parsedValue = parseFloat(info.value);
                const finalValue = !isNaN(parsedValue) ? parsedValue : null;

                // FIX 2: Use the exact schema fields the AI passed through first
                let low = parseFloat(info.reference_range_low);
                let high = parseFloat(info.reference_range_high);

                // Fallback ONLY if the AI missed them but we have a hyphenated string
                if (isNaN(low) && isNaN(high) && info.ref_range && typeof info.ref_range === 'string') {
                    const parts = info.ref_range.split('-');
                    if (parts.length === 2) {
                        low = parseFloat(parts[0].trim());
                        high = parseFloat(parts[1].trim());
                    }
                }

                // Protect the CHECK constraints: fall back to 'normal' and 'green' if missing
                const validInterpretations = ['normal', 'low', 'high', 'critical_low', 'critical_high'];
                const interpretation = validInterpretations.includes(info.interpretation) ? info.interpretation : 'normal';

                const validStatuses = ['green', 'amber', 'red'];
                const allvi_status = validStatuses.includes(info.allvi_status) ? info.allvi_status : 'green';

                return {
                    patient_id: patientId,                                     // NOT NULL
                    sampled_at: test_date || new Date().toISOString().split('T')[0], // NOT NULL
                    display_name: info.label || key,                           // NOT NULL

                    lab_upload_id: lab_upload_id || null,
                    loinc_code: info.loinc_code || null,

                    value_quantity: finalValue,                                // numeric(10,4)
                    value_unit: info.unit || null,
                    lab_name:info.lab_name,

                    reference_range_low: !isNaN(low) ? low : null,             // numeric(10,4)
                    reference_range_high: !isNaN(high) ? high : null,          // numeric(10,4)
                    reference_range_unit: info.unit || null,

                    // 🛡️ Strict schema constraint requirements
                    fhir_resource_type: 'Observation',
                    fhir_status: 'final',
                    entry_method: 'upload_parsed',
                    interpretation: interpretation,
                    allvi_status: allvi_status,
                    clinician_verified: false
                };
            });

            // 3. Bulk insert the exact array into the table
            const { data, error } = await supabaseAdmin
                .from('lab_results')
                .insert(rowsToInsert)
                .select('*');

            if (error) {
                console.error("❌ SQL INSERT ERROR:", error.message);
                throw error;
            }

            return res.status(200).json({ success: true, data });

        } catch (err) {
            console.error("❌ CONFIRM RESULTS CATCH ERROR:", err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
    },
    /**
     * Processes full onboarding form submissions, saving metadata into public.intake_forms 
     * and saving accompanying files inside public.lab_uploads schema mappings.
     */
    submitOnboardingIntake: async (req, res) => {
        console.log("📥 Incoming Intake Text Payload Fields:", req.body);
        console.log("📎 Accompanying Form Upload File Buffer:", req.file);

        const patientId = req.user.id; // Extracted safely via requireAuth context mapping definitions

        try {
            const {
                fullName, phone, dob, gender, location,
                conditions, conditionOther,
                symptomsEnergy, symptomsDigestion, symptomsMental, symptomsSleep, symptomsOther,
                symptomsOtherText, worstSymptoms,
                takingMedication, medicationDetails, medicationDuration, supplements,
                dietaryChanges, dietOther, stressLevel, sleepQuality, exercise, exerciseType,
                topGoals, topHelp, anythingElse, commTime
            } = req.body;

            // 1. Parsing text arrays safely out of multi-part form strings
            const parsedConditions = conditions ? JSON.parse(conditions) : [];
            const parsedSymptomsEnergy = symptomsEnergy ? JSON.parse(symptomsEnergy) : [];
            const parsedSymptomsDigestion = symptomsDigestion ? JSON.parse(symptomsDigestion) : [];
            const parsedSymptomsMental = symptomsMental ? JSON.parse(symptomsMental) : [];
            const parsedSymptomsSleep = symptomsSleep ? JSON.parse(symptomsSleep) : [];
            const parsedSymptomsOther = symptomsOther ? JSON.parse(symptomsOther) : [];
            const parsedDietaryChanges = dietaryChanges ? JSON.parse(dietaryChanges) : [];

            // Combine symptoms across vectors for primary table storage strings 
            const combinedPrimarySymptoms = [
                ...parsedSymptomsEnergy,
                ...parsedSymptomsDigestion,
                ...parsedSymptomsMental,
                ...parsedSymptomsSleep,
                ...parsedSymptomsOther
            ];

            // 2. Format condition mapping enum explicitly as per public.condition_name rules
            const primaryConditionText = parsedConditions[0] || 'Thyroid';
            let formattedConditionEnum = 'hashimotos'; // Fallback mapping match baseline

            if (primaryConditionText.toLowerCase().includes('pcos')) formattedConditionEnum = 'pcos';
            else if (primaryConditionText.toLowerCase().includes('endo')) formattedConditionEnum = 'endometriosis';
            else if (primaryConditionText.toLowerCase().includes('peri')) formattedConditionEnum = 'perimenopause';
            else if (primaryConditionText.toLowerCase().includes('meno')) formattedConditionEnum = 'menopause';

            // 3. Assemble custom JSONB payload metadata structure for dynamic variables
            const conditionDataJsonb = {
                worst_symptoms_summary: worstSymptoms || null,
                symptoms_impact_duration: medicationDuration || null,
                medication_status_flag: takingMedication || 'No',
                medication_raw_details: medicationDetails || null,
                additional_diet_meta: dietOther || null,
                subjective_stress_level: stressLevel || null,
                subjective_sleep_quality: sleepQuality || null,
                exercise_frequency: exercise || null,
                exercise_routine_details: exerciseType || null,
                primary_assistance_target: topHelp || null,
                preferred_checkin_window: commTime || null,
                symptoms_other_custom_text: symptomsOtherText || null
            };

            // 4. Update core patient profile demographics with enrollment metrics verified data
            const { error: profileUpdateErr } = await supabaseAdmin
                .from('profiles')
                .update({
                    phone: phone || null,
                    date_of_birth: dob || null
                })
                .eq('id', patientId);

            if (profileUpdateErr) throw profileUpdateErr;

            // 5. UPSERT the values down inside public.intake_forms
            // This transforms the initial invitation record state into a verified production row
            const { data: intakeRecord, error: intakeErr } = await supabaseAdmin
                .from('intake_forms')
                .upsert([{
                    patient_id: patientId,
                    condition: formattedConditionEnum,
                    version: 1, // Base initial baseline schema profile mapping
                    status: 'submitted',
                    current_medications: medicationDetails ? [medicationDetails] : [],
                    current_supplements: supplements ? supplements.split(',').map(s => s.trim()) : [],
                    diet_protocol: parsedDietaryChanges.join(', ') || 'Standard',
                    primary_symptoms: combinedPrimarySymptoms,
                    goals_free_text: topGoals || null,
                    condition_data: conditionDataJsonb,
                    clinician_notes: conditionOther ? `Other conditions reported: ${conditionOther}. ` : '' + (anythingElse || '')
                }], { onConflict: 'patient_id, condition, version' })
                .select('*')
                .single();

            if (intakeErr) throw intakeErr;

            // 6. 📎 OPTIONAL: Process and track binary files inside public.lab_uploads
            let uploadRecordId = null;
            let aiParsedReportData = null;

            if (req.file) {
                const cleanFileName = req.file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
                const storagePath = `lab-uploads/${patientId}/${Date.now()}_${cleanFileName}`;
                const fileTypeExtension = req.file.mimetype.split('/')[1] || 'pdf';

                // Transaction A: Upload direct raw buffer stream into private Supabase storage bucket
                const { error: storageBucketErr } = await supabaseAdmin.storage
                    .from('lab-uploads')
                    .upload(storagePath, req.file.buffer, {
                        contentType: req.file.mimetype,
                        cacheControl: '3600'
                    });

                if (storageBucketErr) throw storageBucketErr;

                // Transaction B: Write row entry tracking configurations directly into the lab_uploads schema
                const { data: uploadRecord, error: uploadDbErr } = await supabaseAdmin
                    .from('lab_uploads')
                    .insert([{
                        patient_id: patientId,
                        storage_path: storagePath,
                        file_name: req.file.originalname,
                        file_type: ['pdf', 'jpeg', 'png'].includes(fileTypeExtension) ? fileTypeExtension : 'pdf',
                        file_size_bytes: req.file.size,
                        upload_status: 'virus_scanned'
                    }])
                    .select('id')
                    .single();

                if (uploadDbErr) {
                    // Evacuate bad bucket upload storage footprint if data track metadata logs drop
                    await supabaseAdmin.storage.from('lab-uploads').remove([storagePath]);
                    throw uploadDbErr;
                }

                uploadRecordId = uploadRecord.id;

                // Transaction C: Run extraction automation logic streams using your connected AI Engine modules
                try {
                    aiParsedReportData = await aiService.extractLabReport(req.file.buffer, req.file.mimetype);
                } catch (aiErr) {
                    console.error("⚠️ AI Extraction failed or timed out. Saving file path as fallback:", aiErr.message);
                }
            }

            // 7. Update relationship tracking flags inside parent tables
            await supabaseAdmin
                .from('patient_enrolments')
                .update({ updated_at: new Date().toISOString() })
                .eq('patient_id', patientId);

           console.log(aiParsedReportData)

            // Return unified status response maps to transition your front-end components seamlessly
            return res.status(200).json({
                success: true,
                message: "Onboarding form processing cycle completed safely.",
                allvi_id: patientId,
                intakeId: intakeRecord.id,
                uploadTrackId: uploadRecordId,
                parsedData: aiParsedReportData
            });

        } catch (err) {
            console.error("❌ CRITICAL INTAKE SUBMISSION SEED FAILURE:", err.message);
            return res.status(500).json({ success: false, error: err.message || "Internal engine database link crash." });
        }
    }
};

module.exports = HealthController;