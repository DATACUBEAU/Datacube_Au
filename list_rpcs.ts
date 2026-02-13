import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dhmukdeljiwvvwjdcxgn.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobXVrZGVsaml3dnZ3amRjeGduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTIwNjAyOCwiZXhwIjoyMDgwNzgyMDI4fQ.3lrr0S4UH-9mccuIZAxn1TH82d-SezY19ny8OTaiS2o';

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
