const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

// Using the stable flash model for reliable, fast JSON extraction
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel(
    { model: "gemini-3-flash-preview" },
    { apiVersion: "v1beta" }
);

class AIService {


    async generatePatientInsights(labs, symptoms, intake) {
        const dataSummary = `
            Patient Lab History: ${JSON.stringify(labs)}
            Patient Symptom History: ${JSON.stringify(symptoms)}
            Patient Intake Form: ${JSON.stringify(intake)}
        `;

        const prompt = `
            You are a clinical data analyst. 
            Analyze this patient's health data (including their intake goals, symptoms, and lab results). 
            Provide a structured summary in three sections: POSITIVE TRENDS, AREAS OF CONCERN, and NEEDS ATTENTION. 
            Keep it clinically precise.
        `;

        const result = await model.generateContent([prompt, dataSummary]);
        return result.response.text();
    }

    async extractLabReport(fileBuffer, mimeType) {
        const filePart = {
            inlineData: {
                data: fileBuffer.toString("base64"),
                mimeType: mimeType
            }
        };

        /*const prompt = `
        ACT AS: A clinical data extraction engine compliant with HL7 FHIR structures and PostgreSQL structural constraints.
        TASK: Extract every single laboratory test result from the provided medical document image or PDF text fields.
        
        REQUIRED JSON STRUCTURE:
        {
          "test_date": "YYYY-MM-DD",
          "lab_name": "string or null",
          "ordering_clinician": "string or null",
          "biomarkers": [
            {
              "display_name": label,
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
        7. "label": Exact, formal test name.
    
        RULES: 
        - Return ONLY pure, raw, valid JSON text. 
        - Do NOT wrap the JSON output inside markdown backticks or triple-backtick block strings.
    `;*/
        const prompt = `ACT AS: A clinical data extraction engine compliant with HL7 FHIR structures and PostgreSQL structural constraints.
        TASK: Extract every single laboratory test result from the provided medical document image or PDF text fields.

        REQUIRED JSON STRUCTURE:
        {
       "sampled_at": "YYYY-MM-DD",
       "lab_name": "string or null",
        "ordering_clinician": "string or null",
       "biomarkers": [
        {
      "display_name": "string",
      "lab_name": "string or null",
      "loinc_code": "string or null",
      "value_quantity": 0.0000,
      "value_unit": "string or null",
      "reference_range_low": 0.0000,
      "reference_range_high": 0.0000,
      "reference_range_unit": "string or null",
      "interpretation": "normal | low | high | critical_low | critical_high",
      "allvi_status": "green | amber | red"
       }
     ]
     }

      CRITICAL DATABASE SCHEMA CONSTRAINTS & PARSING INSTRUCTIONS:

    1. LAB NAME MAPPING ("lab_name"):
    - Global level: Extract the master diagnostic facility name found in the document header.
     - Biomarker level: For each item inside the "biomarkers" array, explicitly assign the responsible laboratory facility string (e.g., 'Quest', 'LabCorp', 'NHS'). If the document is from a single facility, populate this field with the same global lab name across all rows.

    2. DATE ALIGNMENT ("sampled_at"):
      - Locate the collection date (the date blood was drawn, NOT the report generation or print date).
      - Format strictly as a "YYYY-MM-DD" text string. This maps directly to a PostgreSQL DATE NOT NULL constraint.

    3. NUMERIC FIELDS ("value_quantity", "reference_range_low", "reference_range_high"):
     - Must be parsed strictly as plain numeric floating-point values (e.g., 4.5000) or null.
     - Do NOT include text, comparison operators (<, >, >=), or alpha characters.
     - Max precision limit is NUMERIC(10,4). Truncate values to 4 decimal places max if necessary.

    4. STRINGS AND ENUMS ("interpretation", "allvi_status"):
      - "interpretation" MUST strictly match one of these lowercase enums or default to null if unclear:
       * 'normal' (strictly within standard reference intervals)
       * 'low' (below reference range)
       * 'high' (above reference range)
       * 'critical_low' (severely below range/flagged as critical)
       * 'critical_high' (severely above range/flagged as critical)
       - "allvi_status" MUST match your structural CHECK constraint:
       * 'green' (optimal or safe normal tier values)
       * 'amber' (borderline elevated risk or mildly out of bounds values)
       * 'red' (severely abnormal or critical warning tier flags)
       *  "lab_name": "string or null"

    5. UNIT MATCHING ("value_unit", "reference_range_unit"):
      - "value_unit": Extract the printed units (e.g., 'mIU/L', 'ng/dL', 'ng/mL').
     - "reference_range_unit": Populate with the exact measurement criteria unit of the reference index interval. If identical to value_unit, repeat it here.

    6. CLINICAL CODES ("display_name", "loinc_code"):
      - "display_name": Capture the explicit formal text name string printed on the lab line (e.g., 'TSH', 'Free T4', 'Ferritin'). This is a NOT NULL constraint.
     - "loinc_code": Cross-reference the identified test name to its official LOINC standard identifier string if clearly apparent or extractable (e.g., '3016-3' for TSH). If not identifiable, return null.

    EXTRACTION OUTPUT RULES:
      - Return ONLY pure, raw, valid JSON text.
       -  Do NOT wrap the JSON output inside markdown backticks, markdown syntax labels, or triple-backtick block structures (\`\`\`json ... \`\`\`).
      - If a value cannot be found in the document, map it to null rather than omitting the key.
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