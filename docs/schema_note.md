Schema verification notes:
- Local PostgreSQL schema (from supabase-schema.sql): title TEXT NOT NULL, expiry_date DATE (nullable)
- Supabase mirror writes to same-named table; if Supabase schema has expiry_date as NOT NULL, need migration
- Ensure all code paths pass NULL (not empty string) for dates
