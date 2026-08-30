const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL || "https://your-project.supabase.co",
  process.env.SUPABASE_ANON_KEY || "your-supabase-anon-key"
);

module.exports = supabase;
