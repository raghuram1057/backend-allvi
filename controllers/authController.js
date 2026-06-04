const { supabase, supabaseAdmin } = require('../config/supabase');
const logService = require('../services/logService');
require('dotenv').config();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const enrollPatient = async (req, res) => {
    console.log("📥 Incoming Enrollment Payload:", req.body);
    const { fullName, email, primaryCondition, referringClinician, treatingClinicianEmail } = req.body;

    if (!fullName || !email || !primaryCondition) {
        return res.status(400).json({ success: false, message: "Patient name, email, and condition are required." });
    }
    const cleanEmail = email.trim().toLowerCase();
    const activeOrgId = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"

    try {
        // 1. Verify if invitation record or user profile exists
        const { data: existingProfile } = await supabaseAdmin
            .from('profiles')
            .select('id, email')
            .eq('email', cleanEmail)
            .maybeSingle();

        if (existingProfile) {
            return res.status(409).json({ success: false, message: "An invitation or profile already exists for this email." });
        }

        // Auto-generate high-similarity unique corporate IDs matching 'Allvi-XXXX'
        const uniqueSeed = crypto.randomInt(1000, 9999);
        const generatedAllviId = `Allvi-${uniqueSeed}`;

        // Development fallback keys
        const activeOrgId = req.body.orgId || "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

        // Step A: Seed baseline custom profile
        const { data: newProfile, error: profileErr } = await supabaseAdmin
            .from('profiles')
            .insert([{
                id: generatedAllviId,
                email: cleanEmail,
                role: 'patient',
                full_name: fullName,
                country_code: 'GB',
                timezone: 'Europe/London'
            }])
            .select('*')
            .single();

        if (profileErr) throw profileErr;

        // Step B: Initialize enrollment matrix logs parameters 
        const { data: enrolmentRecord, error: enrolmentErr } = await supabaseAdmin
            .from('patient_enrolments')
            .insert([{
                patient_id: newProfile.id,
                org_id: activeOrgId, // Linked tracking org context mapping
                status: 'invited',
                enrolment_date: new Date().toISOString().split('T')[0],
                magic_link_sent_at: new Date().toISOString(),
                discharge_reason: referringClinician ? `Referred by: ${referringClinician}` : null
            }])
            .select('*')
            .single();

        if (enrolmentErr) {
            // Rollback loose record if the enrollment relationship fails to link
            await supabaseAdmin.from('profiles').delete().eq('id', generatedAllviId);
            throw enrolmentErr;
        }

        // Step C: Open placeholder configuration container maps within intake schema tables
        await supabaseAdmin
            .from('intake_forms')
            .insert([{
                patient_id: newProfile.id,
                condition: primaryCondition.toLowerCase().includes('pcos') ? 'pcos' :
                    primaryCondition.toLowerCase().includes('endo') ? 'endometriosis' :
                        primaryCondition.toLowerCase().includes('peri') ? 'perimenopause' :
                            primaryCondition.toLowerCase().includes('meno') ? 'menopause' : 'hashimotos',
                status: 'invited',
                version: 1,
                clinician_notes: `Invited via dashboard form. Referring: ${referringClinician || 'None'}. Contact: ${treatingClinicianEmail || 'None'}`
            }]);

        /* ==========================================================
             🚀 EMAIL DISPATCH LAYER: Deployed Vercel Core Target Link
             ========================================================== */
        const productionBaseUrl = 'https://clinic-test-ten.vercel.app';
        const magicActivationLink = `${productionBaseUrl}`;

        const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 587, // Change from 465 to 587
            secure: false, // true for 465, false for other ports
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            },
            // Prevent Render from hanging infinitely if connection drops
            connectionTimeout: 6000,
            greetingTimeout: 5000,
            socketTimeout: 10000
        });

        const mailOptions = {
            from: `"Allvi Health Teams" <${process.env.EMAIL_USER}>`,
            to: cleanEmail,
            subject: `Complete Your Allvi Health Registration — Onboarding Invitation`,
            html: `
                <div style="font-family: 'DM Sans', sans-serif; color: #1F2937; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #EDE7DB; border-radius: 12px; background-color: #FFFFFF;">
                    <h2 style="color: #0F4C5C; font-family: 'Playfair Display', serif; margin-top: 0; font-size: 22px;">Welcome to Allvi Health, ${fullName}!</h2>
                    <p style="font-size: 14px; line-height: 1.6;">Your clinical team has invited you to join your secure, condition-specific management tracking workspace parameters.</p>
                    
                    <p style="font-size: 14px; line-height: 1.6;">To finalize your profile, pick a safe account password, and unlock access to your portal dashboard, please select the confirmation option below:</p>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${magicActivationLink}" style="background-color: #0F4C5C; color: #F7F1E8; padding: 12px 26px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block; font-size: 14px;">
                            Activate Your Tracking Account →
                        </a>
                    </div>
                    
                    <p style="font-size: 12px; color: #6B7280; margin-top: 24px;">
                        If the option link button module fails to open, copy and paste this URL string directly into your browser context search bar:<br/>
                        <a href="${magicActivationLink}" style="color: #1A6B7C; word-break: break-all;">${magicActivationLink}</a>
                    </p>
                    <hr style="border: 0; border-top: 1px solid #EDE7DB; margin: 20px 0;" />
                    <p style="font-size: 11px; color: #6B7280;">This email is an automated lifecycle tracking dispatch configured by your connected clinical team.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        console.log(`✉️ Magic activation email dispatched safely to: ${cleanEmail}`);

        // Return unified creation payload tokens back to the dashboard UI
        return res.status(201).json({
            success: true,
            message: "Patient enrollment initialized successfully and magic activation link sent.",
            allviId: newProfile.id,
            email: newProfile.email,
            enrolmentId: enrolmentRecord.id
        });
        // REPLACE YOUR EMAIL BLOCK WITH THIS TEMPORARILY:
        /*console.log("Skipping email for debug...");
        return res.status(201).json({
            success: true,
            message: "Patient enrollment initialized successfully (Email skipped).",
            allviId: newProfile.id,
            enrolmentId: enrolmentRecord.id
        });*/
    } catch (err) {
        console.error("❌ ENROLLMENT ROUTINE EXCEPTION:", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
};

const activateAccount = async (req, res) => {
    const emailInput = req.body.email ? req.body.email.toLowerCase().trim() : '';
    const passwordInput = req.body.password;

    if (!emailInput || !passwordInput) {
        return res.status(400).json({ success: false, message: "Missing required profile properties parameters." });
    }

    try {
        // 1. Find the pre-existing profile row created during enrollment
        const { data: existingProfile, error: fetchErr } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('email', emailInput)
            .maybeSingle();

        if (fetchErr) throw fetchErr;
        if (!existingProfile) return res.status(404).json({ success: false, message: "Invitation record not found." });

        // Safety Gate: If it already has BOTH a password and auth ID, it's truly active
        if (existingProfile.auth_user_id && existingProfile.password) {
            return res.status(400).json({ success: false, message: "Account already active. Please log in." });
        }

        let confirmedAuthUserId = null;
        let activeSession = null;

        // 2. Try to register the user credentials inside Supabase Auth
        const { data: authData, error: signUpError } = await supabase.auth.signUp({
            email: emailInput,
            password: passwordInput, // Plaintext goes to Supabase Auth handler natively
            options: {
                data: {
                    role: existingProfile.role,
                    country_code: existingProfile.country_code
                }
            }
        });

        if (signUpError) {
            // 🧠 THE AUTOMATIC BYPASS: If they already exist in Auth, don't crash!
            if (signUpError.message.toLowerCase().includes('already registered')) {
                console.log(`ℹ️ Email exists in auth.users. Fetching existing user ID to link details automatically...`);

                // Because we cannot access authData, we sign them in with the password to grab their ID and create a session
                const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
                    email: emailInput,
                    password: passwordInput
                });

                if (signInErr) {
                    console.error("❌ Auth match failed:", signInErr.message);
                    return res.status(400).json({
                        success: false,
                        message: "User exists in Auth but password validation failed. Reset your user dashboard or change your test email."
                    });
                }

                confirmedAuthUserId = signInData.user.id;
                activeSession = signInData.session;
            } else {
                return res.status(400).json({ success: false, error: signUpError.message });
            }
        } else {
            // New sign up successful
            confirmedAuthUserId = authData.user.id;
            activeSession = authData.session;

            // 🚀 AUTOMATIC EMAIL CONFIRMATION BYPASS FALLBACK:
            // If your Supabase instance has email verification turned ON, authData.session 
            // returns null on a brand-new registration. We force a background sign-in here to 
            // guarantee a valid token string is passed down to the frontend cache layout.
            if (!activeSession) {
                console.log("🔑 Email verification layer detected. Forcing active session generation...");
                const { data: forceSignInData, error: forceSignInErr } = await supabase.auth.signInWithPassword({
                    email: emailInput,
                    password: passwordInput
                });

                if (!forceSignInErr) {
                    activeSession = forceSignInData.session;
                } else {
                    console.warn("⚠️ Fallback session generation bypassed:", forceSignInErr.message);
                }
            }
        }

        /* ==========================================================
           🚀 ENCRYPTION LAYER: Hash the password before saving to DB
           ========================================================== */
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(passwordInput, saltRounds);

        // 3. UPDATE THE EXISTING PROFILE ROW (Guaranteed to execute now!)
        // This maps the generated auth UUID and the safe HASHED password into your row
        const { data: completeProfile, error: profileErr } = await supabaseAdmin
            .from('profiles')
            .update({
                auth_user_id: confirmedAuthUserId,
                password: hashedPassword, // 🔑 Enforced: Secure encrypted hash committed to database
                updated_at: new Date().toISOString()
            })
            .eq('id', existingProfile.id)
            .select('*')
            .single();

        if (profileErr) throw profileErr;

        // 4. Update the activation tracking record status
        await supabaseAdmin
            .from('patient_enrolments')
            .update({ status: 'active', magic_link_used_at: new Date().toISOString() })
            .eq('patient_id', completeProfile.id);

        return res.status(200).json({
            success: true,
            message: "Account activation complete and encrypted profile data synced successfully.",
            session: activeSession, // 🛡️ Clean 3-segment token object map payload
            allviId: completeProfile.id,
            patient: completeProfile
        });

    } catch (err) {
        console.error("❌ ACTIVATION ROUTINE ERROR:", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
};


const forgotPassword = async (req, res) => {
    const { identifier } = req.body; // Expects { "identifier": "Allvi-XXXX" or "email@..." }
    const cleanIdentifier = identifier ? identifier.trim().toLowerCase() : '';

    if (!cleanIdentifier) {
        return res.status(400).json({ success: false, message: "Identifier is required." });
    }

    try {
        // 1. Resolve to email: Look up in profiles using the OR condition
        const { data: profileRecord, error: lookupErr } = await supabaseAdmin
            .from('profiles')
            .select('email')
            .or(`email.eq."${cleanIdentifier}",id.eq."${cleanIdentifier}"`)
            .maybeSingle();

        if (lookupErr || !profileRecord) {
            return res.status(404).json({ success: false, message: "User account not found." });
        }

        // 2. Trigger Supabase Auth Password Reset
        // Note: This sends an email using the template configured in your Supabase Dashboard
        const { error: resetErr } = await supabase.auth.resetPasswordForEmail(profileRecord.email, {
            redirectTo: `${process.env.CLIENT_URL || 'https://clinic-test-ten.vercel.app'}/update-password`,
        });

        if (resetErr) throw resetErr;

        return res.status(200).json({
            success: true,
            message: "Password reset link has been dispatched to your registered email address."
        });

    } catch (err) {
        console.error("❌ FORGOT PASSWORD ROUTINE ERROR:", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
};
const login = async (req, res) => {
    const inputIdentifier = req.body.allviId || req.body.email;
    const cleanIdentifier = inputIdentifier ? inputIdentifier.trim().toLowerCase() : '';
    const passwordInput = req.body.password;

    if (!cleanIdentifier || !passwordInput) {
        return res.status(400).json({ success: false, message: "Missing required parameters." });
    }

    try {
        // 1. Fetch profile using supabaseAdmin to bypass RLS limits during lookup
        // 🚨 CRITICAL: Explicitly select the 'password' column here to compare it later
        const { data: profileRecord, error: lookupErr } = await supabaseAdmin
            .from('profiles')
            .select('email, id, role, password')
            .or(`email.eq."${cleanIdentifier}",id.eq."${cleanIdentifier}"`)
            .maybeSingle();

        if (lookupErr || !profileRecord) {
            console.log("🔍 Lookup failed or profile not found in database.");
            return res.status(401).json({ success: false, message: "Invalid credentials or unactivated profile." });
        }

        // 2. 🔐 BCRYPT COMPARE: Verify the hashed password stored in your profiles table
        if (!profileRecord.password) {
            return res.status(401).json({ success: false, message: "Account profile exists but has not been activated with a password yet." });
        }

        const isPasswordMatch = await bcrypt.compare(passwordInput, profileRecord.password);
        if (!isPasswordMatch) {
            return res.status(401).json({ success: false, message: "Invalid credentials combination." });
        }

        // 3. Authenticate with Supabase Auth to generate session tokens (JWTs)
        const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
            email: profileRecord.email,
            password: passwordInput
        });

        if (authErr) {
            console.error("❌ Supabase Auth authentication failed:", authErr.message);
            return res.status(401).json({ success: false, message: "Authentication engine sync error." });
        }

        // 4. Fetch full profile information for client application state usage
        const { data: completeProfile } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', profileRecord.id)
            .maybeSingle();

        // 5. Sanitize sensitive properties before returning payload to frontend
        const sanitizedPatient = { ...completeProfile };
        delete sanitizedPatient.password;

        return res.status(200).json({
            success: true,
            message: "Login successful.",
            session: authData.session, // Contains access_token and refresh_token
            patient: sanitizedPatient
        });

    } catch (err) {
        console.error("❌ CONTROLLER ENCOUNTERED CRASH:", err.message);
        return res.status(500).json({ success: false, error: "Internal core engine runtime crash during login." });
    }
};

const verifyUser = async (req, res) => {
    const { identifier } = req.body;
    const cleanIdentifier = identifier.trim().toLowerCase();

    try {
        const { data: profile, error } = await supabaseAdmin
            .from('profiles')
            .select('id, email')
            .or(`email.eq."${cleanIdentifier}",id.eq."${cleanIdentifier}"`)
            .maybeSingle();

        if (error || !profile) {
            return res.status(404).json({ success: false, message: "No account found with this ID or Email." });
        }

        // Return the ID so the frontend knows WHO to update
        res.status(200).json({ success: true, userId: profile.id });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

const updatePassword = async (req, res) => {
    const { userId, newPassword } = req.body; // userId should be the 'id' from profiles


    try {
        // 1. Fetch the profile to get the auth_user_id (the UUID)
        const { data: profile, error: profileErr } = await supabaseAdmin
            .from('profiles')
            .select('auth_user_id')
            .eq('id', userId)
            .single();

        if (profileErr || !profile.auth_user_id) {
            throw new Error("Could not find Auth ID for this profile.");
        }

        // 2. Update the password in Supabase Auth (The Auth Engine)
        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
            profile.auth_user_id,
            { password: newPassword }
        );
        if (authError) throw authError;

        // 3. Update the password in your 'profiles' table (The Bcrypt Hash)
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const { error: dbError } = await supabaseAdmin
            .from('profiles')
            .update({ password: hashedPassword })
            .eq('id', userId);

        if (dbError) throw dbError;

        res.status(200).json({ success: true, message: "Password synchronized across all systems." });
    } catch (err) {
        console.error("❌ SYNC ERROR:", err.message);
        res.status(500).json({ success: false, error: "Failed to sync password." });
    }
};
module.exports = { enrollPatient, activateAccount, login, forgotPassword, verifyUser, updatePassword };