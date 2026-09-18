const { createClient } = require("@supabase/supabase-js");

// Admin client for server-side operations (storage, admin queries)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Public client for client-side operations (auth, reads)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = { supabase, supabaseAdmin };
