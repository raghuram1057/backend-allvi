const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

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
            ACT AS: A clinical data extraction engine compliant with HL7 FHIR structures.
            TASK: Extract every single laboratory test result from the provided medical document image or PDF text fields.
            
            REQUIRED JSON STRUCTURE:
            {
              "test_date": "YYYY-MM-DD",
              "biomarkers": {
                "standardized_key": { "label": "Full Test Name", "value": 0.0, "unit": "string", "ref_range": "string" }
              }
            }
            
            INSTRUCTIONS:
            1. "test_date": Locate sample collection or report date. Default to current date string if unreturned.
            2. "standardized_key": short, lowercase_underscored name (e.g., "tsh", "free_t4", "ferritin", "vit_b12").
            3. "label": Exact, formal test title text.
            4. "value": Extract ONLY the number as a structural float element value. If less than e.g. "<0.1", return 0.1.
            5. "unit": Extract structural unit value strings (e.g., "mIU/L", "ng/dL").
            6. "ref_range": Extract explicitly readable reference interval strings.
            
            RULES: Identify EVERY marker printed. Return ONLY pure raw valid JSON text. Do NOT wrap output inside backticks or markdown formatting indicators.
        `;

        const result = await model.generateContent([prompt, filePart]);
        let aiText = result.response.text().trim();
        
        // Sanitize unexpected output formatting choices safely
        aiText = aiText.replace(/```json/gi, '').replace(/```/g, '').trim();
        
        const extractedData = JSON.parse(aiText);
        
        // Standardize biomarkers schema loops
        const normalizedBiomarkers = {};
        if (extractedData.biomarkers) {
            for (const [key, markerData] of Object.entries(extractedData.biomarkers)) {
                const numericValue = parseFloat(markerData.value);
                normalizedBiomarkers[key] = {
                    label: markerData.label || key,
                    value: isNaN(numericValue) ? 0 : numericValue,
                    unit: markerData.unit || '',
                    ref_range: markerData.ref_range || ''
                };
            }
        }

        return {
            test_date: extractedData.test_date || new Date().toISOString().split('T')[0],
            biomarkers: normalizedBiomarkers
        };
    }
}

module.exports = new AIService();