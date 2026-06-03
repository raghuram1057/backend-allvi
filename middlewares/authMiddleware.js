const { supabase, supabaseAdmin } = require('../config/supabase');

/**
 * Validates Native Supabase JWT Bearer tokens to protect backend entry workflows.
 */
const requireAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: "Missing or poorly formatted Authorization tokens." });
    }

    const token = authHeader.split(' ')[1];

    try {
        // 1. Live-verify token signature and freshness straight against Supabase Auth Engine
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user) {
            // 🚀 COPIED REJECTION DIAGNOSTIC TRACE:
            console.error("🚨 SUPABASE core engine explicitly rejected token. Reason:", error ? error.message : "User payload missing.");
            console.log("⚙️ Verified checking against server instance URL:", process.env.SUPABASE_URL);
            
            return res.status(401).json({ success: false, message: "Invalid session identity tokens or token expired." });
        }

        // 2. Fetch corresponding profile using auth_user_id (Bypasses custom Allvi-ID structural mismatch)
        const { data: profile, error: profError } = await supabaseAdmin
            .from('profiles')
            .select('id, role, country_code')
            .eq('auth_user_id', user.id) 
            .maybeSingle(); 

        if (profError || !profile) {
            console.error("🔍 Profile lookup failed for Auth UUID:", user.id, profError?.message);
            return res.status(403).json({ success: false, message: "Access forbidden. User profile map does not exist." });
        }

        // 3. Merge workspace metrics down to process context parameters safely
        req.user = {
            id: profile.id, // Assigns "Allvi-XXXX" string to keep your health controller stable
            supabaseAuthId: user.id, 
            email: user.email,
            role: profile.role,
            countryCode: profile.country_code
        };

        next();
    } catch (err) {
        console.error("❌ AUTH MIDDLEWARE EXCEPTION:", err.message);
        return res.status(500).json({ success: false, error: "Internal session identity authorization sequence validation crash." });
    }
};

module.exports = requireAuth;