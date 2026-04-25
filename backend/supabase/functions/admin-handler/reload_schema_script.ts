
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import * as postgres from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const dbUrl = Deno.env.get("SUPABASE_DB_URL")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
  console.log("Connecting to DB...");
  const pool = new postgres.Pool(dbUrl, 3, true);
  const connection = await pool.connect();
  
  try {
    console.log("Running schema reload migration...");
    await connection.queryObject`
      NOTIFY pgrst, 'reload schema';
      
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'au_api_keys' AND column_name = 'updated_at') THEN
              ALTER TABLE au_api_keys ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
          END IF;
      END $$;
    `;
    console.log("Migration executed successfully.");
  } catch (e) {
    console.error("Migration failed:", e);
  } finally {
    connection.release();
    await pool.end();
  }
}

runMigration();
