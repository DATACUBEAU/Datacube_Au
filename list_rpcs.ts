import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function listRpcs() {
  console.log('--- CHECKING RPCs ---');
  // There is no direct way to list RPCs via the client without postgres access,
  // but we can try common ones or check if we can access pg_proc
  const { data, error } = await supabase.from('pg_proc').select('proname').limit(10);
  if (error) {
    console.log('Cannot access pg_proc directly (expected):', error.message);
  } else {
    console.log('Procedures:', data);
  }

  // Try some common management RPCs if they exist
  const rpcs = ['exec_sql', 'run_sql', 'execute_sql', 'query'];
  for (const rpc of rpcs) {
    const { error: rpcError } = await supabase.rpc(rpc, { sql: 'SELECT 1' });
    if (rpcError) {
      console.log(`RPC ${rpc} error:`, rpcError.message);
    } else {
      console.log(`RPC ${rpc} EXISTS!`);
    }
  }
}

listRpcs();
