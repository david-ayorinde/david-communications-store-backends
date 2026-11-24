const { supabase, isSupabaseConfigured } = require("../config/supabase");

function getBearerToken(req) {
  const authorization = req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice(7).trim() || null;
}

function requireDatabase(req, res, next) {
  if (!isSupabaseConfigured || !supabase) {
    const message =
      "Database is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.";
    return res.status(503).json({ error: message, message });
  }

  next();
}

async function requireAdmin(req, res, next) {
  if (!isSupabaseConfigured || !supabase) {
    const message =
      "Database is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.";
    return res.status(503).json({ error: message, message });
  }

  try {
    const token = getBearerToken(req);

    if (!token) {
      const message = "Authorization token is required.";
      return res.status(401).json({ error: message, message });
    }

    const { data: userData, error: authError } =
      await supabase.auth.getUser(token);

    if (authError || !userData?.user) {
      const message =
        "Your session is invalid or expired. Please sign in again.";
      return res.status(401).json({ error: message, message });
    }

    const { data: admin, error: adminError } = await supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (adminError) {
      console.error("Admin lookup failed:", adminError.message);
      const message = "Could not verify administrator permissions.";
      return res.status(500).json({ error: message, message });
    }

    if (!admin) {
      const message = "This account is not an approved administrator.";
      return res.status(403).json({ error: message, message });
    }

    req.admin = userData.user;
    req.adminUser = userData.user;
    next();
  } catch (error) {
    console.error("Admin verification error:", error.message);
    const message = "Unable to verify admin access.";
    return res.status(500).json({ error: message, message });
  }
}

module.exports = {
  requireAdmin,
  requireDatabase,
};
