import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import fetch from 'node-fetch'

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function run() {
  console.log('Creating temp admin session...')
  
  // 1. Create temp session
  const { data: session, error: sessErr } = await supabase
    .from('au_admin_sessions')
    .insert({
        ip_address: '127.0.0.1',
        is_authenticated: true,
        updated_at: new Date().toISOString()
    })
    .select()
    .single();

  if (sessErr) {
      console.error('Failed to create session:', sessErr);
      process.exit(1);
  }

  const adminToken = session.id;
  console.log('Got Admin Token:', adminToken);

  console.log('Applying migration via admin-handler...')
  
  const response = await fetch(`${supabaseUrl}/functions/v1/admin-handler`, {
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
        'X-Admin-Token': adminToken
    },
    body: JSON.stringify({ action: 'apply_schema_migration' })
  })

  const data = await response.json();
  console.log('Result:', data);

  // Cleanup
  await supabase.from('au_admin_sessions').delete().eq('id', adminToken);
  console.log('Cleanup done.');
}

run()
