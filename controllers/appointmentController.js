const { Resend } = require('resend');
// 🚀 Matches your standard require architecture perfectly
const { supabase, supabaseAdmin } = require('../config/supabase.js');

const resend = new Resend(process.env.RESEND_API_KEY);

const appointmentController = {
    /**
     * Handles dynamic appointment and strategic communication routing logs via Resend
     */
    requestAppointment: async (req, res) => {
        try {
            const { notes } = req.body;

            // Securely extract the patient ID directly from the validated middleware token context
            const patientId = req.params.patientId;

            if (!patientId) {
                return res.status(400).json({ success: false, error: "Patient identification parameter is required." });
            }

            // 🚀 1. Fetch the user's email and full name matching your schema fields
            const { data: profile, error: profileError } = await supabaseAdmin
                .from('profiles')
                .select('email, full_name') // 🌟 Selecting full_name directly
                .eq('id', patientId)
                .maybeSingle();

            if (profileError || !profile) {
                return res.status(404).json({ success: false, error: "Patient profile not found." });
            }

            const userEmail = profile.email;
            const userName = profile.full_name ? profile.full_name.trim() : 'Patient';

            // 🚀 2. Send email using the correct bracket syntax and replyTo address
            const data = await resend.emails.send({
                from: `"${userName} via Allvi Health" <user@allvihealth.com>`, // ✅ Added missing '<' bracket and set proper auth string
                replyTo: userEmail, // 🌟 Allows support team to click reply and address the user directly
                to: 'support@allvihealth.com',
                cc:"rashmi@allvihealth.com",
                subject: `Appointment Booking Request: ${patientId}`,
                html: `
                <div style="font-family: sans-serif; padding: 20px; color: #1F2937;">
                    <h2 style="color: #0F4C5C;">New Appointment Request Received</h2>
                    <p><strong>Sent From (User):</strong> ${userName} (${userEmail})</p>
                    <p><strong>Patient ID Context:</strong> ${patientId}</p>
                    <div style="background: #FDF3E7; padding: 15px; border-left: 4px solid #C97B2E; margin-top: 15px;">
                        <p style="margin: 0; font-weight: 600; color: #C97B2E;">Message / Notes:</p>
                        <p style="margin: 5px 0 0 0; color: #1F2937; line-height: 1.5;">${notes || 'No notes provided.'}</p>
                    </div>
                </div>
            `
            });

            console.log("✉️ Email successfully tracked via Resend:", data); // Moved above the return statement so it actually executes
            return res.status(200).json({ success: true, data });

        } catch (err) {
            console.error("❌ Resend Appointment Booking Failure:", err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
    }
};

// 🌟 Exporting as a single default block to match your exact require statement!
module.exports = appointmentController;