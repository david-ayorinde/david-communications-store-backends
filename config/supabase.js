const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

const isPlaceholder =
  !supabaseUrl ||
  !serviceRoleKey ||
  supabaseUrl.includes("your-project.supabase.co") ||
  serviceRoleKey.includes("your-supabase-service-role-key");

const isSupabaseConfigured = !isPlaceholder;

const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;

if (!isSupabaseConfigured) {
  console.warn(
    "Warning: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing or using placeholder values. Database endpoints will return 503 until configured in .env."
  );
}

module.exports = {
  supabase,
  isSupabaseConfigured,
};
