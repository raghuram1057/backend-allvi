const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

// Using the stable flash model for reliable, fast JSON extraction
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel(
    { model: "gemini-3-flash-preview" },
    { apiVersion: "v1beta" }
);

class AIService {
    async extractLabReport(fileBuffer, mimeType) {
        const filePart = {
            inlineData: {
                data: fileBuffer.toString("base64"),
                mimeType: mimeType
            }
        };

        const prompt = `
    ACT AS: A clinical data extraction engine compliant with HL7 FHIR structures and PostgreSQL structural constraints.
    TASK: Extract every single laboratory test result from the provided medical document image or PDF text fields.
    
    REQUIRED JSON STRUCTURE:
    {
      "test_date": "YYYY-MM-DD",
      "lab_name": "string or null",
      "ordering_clinician": "string or null",
      "biomarkers": [
        {
          "display_name": "Full Test Name",
          "loinc_code": "string or null",
          "value_quantity": 0.0,
          "value_unit": "string or null",
          "reference_range_low": 0.0,
          "reference_range_high": 0.0,
          "interpretation": "normal | low | high | critical_low | critical_high",
          "allvi_status": "green | amber | red"
        }
      ]
    }
    
    INSTRUCTIONS & DATABASE SCHEMA CONSTRAINTS:
    1. "test_date": Locate the sample collection date. Format strictly as YYYY-MM-DD. 
    2. "biomarkers": Return an array of objects. Identify EVERY marker printed.
    3. "value_quantity": Extract ONLY the numeric value as a float.
    4. "reference_range_low" & "reference_range_high": Parse the printed reference interval (e.g., "0.45 - 4.5") into clean, separate lower and upper decimal bounds.
    5. "interpretation": Evaluate mathematically against the low/high bounds and assign exactly one of these lowercase enums:
       - 'normal' (within reference intervals)
       - 'low' (below reference range)
       - 'high' (above reference range)
       - 'critical_low' or 'critical_high' (flagged as critical/panic)
    6. "allvi_status": Assess systemic risk tiering and attach exactly one of these lowercase strings:
       - 'green' (normal range values)
       - 'amber' (borderline out of bounds or elevated risks)
       - 'red' (severely abnormal or critical flags)

    RULES: 
    - Return ONLY pure, raw, valid JSON text. 
    - Do NOT wrap the JSON output inside markdown backticks or triple-backtick block strings.
`;

        const result = await model.generateContent([prompt, filePart]);
        let aiText = result.response.text().trim();

        // Sanitize unexpected output formatting choices safely
        aiText = aiText.replace(/```json/gi, '').replace(/```/g, '').trim();

        let extractedData = {};
        try {
            extractedData = JSON.parse(aiText);
        } catch (parseErr) {
            console.error("AI JSON Parsing Failed:", parseErr);
            throw new Error("Failed to parse AI extraction results.");
        }

        // Standardize biomarkers schema loops for the Frontend Review Page
        const normalizedBiomarkers = {};
        
        if (extractedData.biomarkers && Array.isArray(extractedData.biomarkers)) {
            extractedData.biomarkers.forEach((marker, index) => {
                
                // Create a clean key for the frontend dictionary map (e.g., 'TSH', 'Free_T4')
                const safeKey = marker.display_name 
                    ? marker.display_name.replace(/[^a-zA-Z0-9]/g, '_') 
                    : `marker_${index}`;

                // Reconstruct the visual ref_range string for the frontend input boxes
                let refString = '';
                if (marker.reference_range_low !== null && marker.reference_range_high !== null && marker.reference_range_low !== undefined) {
                    refString = `${marker.reference_range_low} - ${marker.reference_range_high}`;
                } else if (marker.reference_range_low !== null && marker.reference_range_low !== undefined) {
                    refString = `> ${marker.reference_range_low}`;
                } else if (marker.reference_range_high !== null && marker.reference_range_high !== undefined) {
                    refString = `< ${marker.reference_range_high}`;
                }

                // Map AI array elements to the specific dictionary format Phase1Review.jsx expects
                normalizedBiomarkers[safeKey] = {
                    label: marker.display_name || safeKey,
                    // 🛡️ CRITICAL FIX: Safe parsing, defaulting to null instead of 0 if missing
                    value: marker.value_quantity !== null && marker.value_quantity !== undefined ? parseFloat(marker.value_quantity) : null,
                    unit: marker.value_unit || '',
                    ref_range: refString,
                    
                    // Preserve the database constraint fields so they pass straight through the frontend to the controller
                    reference_range_low: marker.reference_range_low !== undefined ? marker.reference_range_low : null,
                    reference_range_high: marker.reference_range_high !== undefined ? marker.reference_range_high : null,
                    interpretation: marker.interpretation || 'normal',
                    allvi_status: marker.allvi_status || 'green',
                    loinc_code: marker.loinc_code || null
                };
            });
        }

        return {
            test_date: extractedData.test_date || new Date().toISOString().split('T')[0],
            lab_name: extractedData.lab_name || null,
            ordering_clinician: extractedData.ordering_clinician || null,
            biomarkers: normalizedBiomarkers
        };
    }
}

module.exports = new AIService();