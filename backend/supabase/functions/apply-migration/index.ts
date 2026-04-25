
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.3/mod.js";
import * as jose from "https://deno.land/x/jose@v4.14.4/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // 1. Auth Check (Verify JWT role is 'service_role')
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
        return new Response("Missing Authorization", { status: 401, headers: corsHeaders });
    }
    const token = authHeader.replace("Bearer ", "");
    const jwtSecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("JWT_SECRET");
    
    if (!jwtSecret) throw new Error("Missing JWT Secret");

    try {
        const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(jwtSecret));
        if (payload.role !== 'service_role') {
             return new Response("Unauthorized: Role must be service_role", { status: 403, headers: corsHeaders });
        }
    } catch (e) {
        console.error("JWT Verification failed:", e);
        return new Response(`Unauthorized: ${e.message}`, { status: 401, headers: corsHeaders });
    }

    // 2. Connect to DB
    const dbUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!dbUrl) throw new Error("Missing SUPABASE_DB_URL");
    
    const sql = postgres(dbUrl);

    // 3. Define Migrations (Idempotent)
    // ... (Keep existing migration strings if needed for future, or just a simple check)
    // For now, let's keep it capable of applying fixes.
    
    // Migration 1: Flags and Cleanup
    const migration1 = `
      -- 1. Feature Flags Table (canonical)
      CREATE TABLE IF NOT EXISTS feature_flags (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          key TEXT UNIQUE NOT NULL,
          enabled BOOLEAN DEFAULT false,
          category TEXT DEFAULT 'general',
          description TEXT DEFAULT '',
          scope TEXT DEFAULT 'global',
          config JSONB DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ DEFAULT now()
      );

      INSERT INTO feature_flags (key, enabled, category, description, scope, config)
      VALUES
        ('billing_enabled', true, 'billing', 'Master monetization switch. If true, promo is forced off.', 'global', '{}'::jsonb),
        ('promo_enabled', false, 'billing', 'Promo mode switch. If true, billing is forced off.', 'global', '{}'::jsonb)
      ON CONFLICT (key) DO NOTHING;

      ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS "Allow public read of feature flags" ON feature_flags;
      CREATE POLICY "Allow public read of feature flags" ON feature_flags FOR SELECT USING (true);

      -- 2. Deletion Log
      CREATE TABLE IF NOT EXISTS au_deletion_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          document_id UUID NOT NULL,
          owner_id UUID,
          file_path TEXT,
          deleted_at TIMESTAMPTZ DEFAULT now(),
          processed BOOLEAN DEFAULT false,
          processed_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_deletion_log_processed ON au_deletion_log(processed);

      -- 3. Trigger
      CREATE OR REPLACE FUNCTION log_document_deletion()
      RETURNS TRIGGER AS $$
      BEGIN
          INSERT INTO au_deletion_log (document_id, owner_id, file_path)
          VALUES (OLD.id, OLD.owner_id, OLD.file_path);
          RETURN OLD;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;

      DROP TRIGGER IF EXISTS on_document_delete_log ON au_documents;
      CREATE TRIGGER on_document_delete_log
      AFTER DELETE ON au_documents
      FOR EACH ROW EXECUTE FUNCTION log_document_deletion();

      -- 4. Indexes
      CREATE INDEX IF NOT EXISTS idx_documents_expires_at ON au_documents(expires_at);
    `;

    const migration2 = `
      DROP TABLE IF EXISTS au_guest_sessions CASCADE;
      NOTIFY pgrst, 'reload config';
    `;

    // 4. Execute
    await sql.unsafe(migration1);
    await sql.unsafe(migration2);

    await sql.end();

    return new Response(JSON.stringify({ ok: true, message: "Migrations applied successfully" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
