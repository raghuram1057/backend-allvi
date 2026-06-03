const { supabaseAdmin } = require('../config/supabase');

/**
 * Writes an immutable footprint record directly into the database compliance logging schema layer.
 * Utilizes the Supabase Service Role client to bypass RLS validation chains securely.
 */
const write = async ({ 
    req, 
    action, 
    resourceType, 
    resourceId, 
    patientId, 
    oldValues = null, 
    newValues = null, 
    metadata = {} 
}) => {
    try {
        // 1. Safely extract network request signatures if executing within an active HTTP context loop
        let actorIp = null;
        let actorId = null;
        let actorRole = 'system';
        let userAgent = 'internal_system_engine';

        if (req) {
            // Evaluates headers for application layers deployed behind reverse proxies (Nginx / Cloudflare / Heroku)
            actorIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                      req.ip || 
                      req.connection?.remoteAddress || 
                      null;
                      
            actorId = req.user?.id || null;
            actorRole = req.user?.role || 'anonymous';
            userAgent = req.headers['user-agent'] || 'unknown';
        }

        // 2. Format the payload structural fields identically with database constraints mapping requirements
        const compliancePayload = {
            actor_id: actorId,
            actor_role: actorRole,
            actor_ip: actorIp,
            action: action,
            resource_type: resourceType || 'profiles',
            resource_id: String(resourceId || 'unknown'),
            patient_id: patientId || null,
            old_values: oldValues,
            new_values: newValues,
            metadata: {
                ...metadata,
                user_agent: userAgent
            },
            gdpr_relevant: true,
            hipaa_relevant: true,
            retention_years: 10,
            created_at: new Date().toISOString()
        };

        // 3. Write record straight down into the secure logs pipeline via service role bypass credentials
        // Note: Change 'compliance_audit_logs' back to 'audit_log' if that is your literal database table name.
        const { error } = await supabaseAdmin
            .from('compliance_audit_logs') 
            .insert([compliancePayload]);

        if (error) {
            console.error(`⚠️ Local Logging Failed to write safely into database arrays: ${error.message}`);
            return false;
        }

        console.log(`🔒 [AUDIT TRACK COMPLETED]: Action [${action}] committed successfully for resource ID: ${resourceId}`);
        return true;

    } catch (err) {
        console.error("❌ Critical Exception caught tracking audit chain lifecycle record:", err.message);
        return false;
    }
};

module.exports = {
    write
};