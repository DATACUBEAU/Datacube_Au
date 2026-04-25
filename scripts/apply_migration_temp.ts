import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing env vars:', { supabaseUrl, hasKey: !!supabaseServiceKey })
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function run() {
  console.log('Applying migration...')
  const sql = 'ALTER TABLE au_api_keys ADD COLUMN IF NOT EXISTS allowed_models TEXT[] DEFAULT NULL; NOTIFY pgrst, "reload schema";'
  
  // Try via rpc 'run_sql' if it exists (it was deployed)
  const { data, error } = await supabase.functions.invoke('run-sql', {
    body: { query: sql }
  })

  if (error) {
      console.error('Function Invoke Error:', error)
      // Fallback: Try direct RPC if you have a postgres function exposed (unlikely for DDL)
      // Or if 'run-sql' function expects different payload.
      // Let's try to check if the function actually exists and what it expects.
      // Usually my 'run-sql' function (from previous turns) takes { query: string }.
  } else {
      console.log('Migration applied:', data)
  }
}

run()
