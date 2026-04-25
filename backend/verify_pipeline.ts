
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const supabaseUrl = 'https://dhmukdeljiwvvwjdcxgn.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobXVrZGVsaml3dnZ3amRjeGduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTIwNjAyOCwiZXhwIjoyMDgwNzgyMDI4fQ.3lrr0S4UH-9mccuIZAxn1TH82d-SezY19ny8OTaiS2o';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function verify() {
  console.log('--- Verifying Database Triggers ---');
  // We can't query pg_trigger directly easily via API, but we can try to trigger it or assume it's there if migration passed.
  // Actually, we can use RPC if we had one, but we don't.
  // Let's check if the trigger function exists by trying to call it? No, it's a trigger function.
  
  // Let's check au_debug_logs to see if any logs exist from our recent changes.
  const { data: logs, error: logError } = await supabase
    .from('au_debug_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  if (logError) {
    console.error('Error fetching logs:', logError);
  } else {
    console.log('Recent Debug Logs:', logs);
  }

  console.log('\n--- Verifying Jobs ---');
  const { data: jobs, error: jobError } = await supabase
    .from('au_upload_jobs')
    .select('id, status, progress, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  if (jobError) {
    console.error('Error fetching jobs:', jobError);
  } else {
    console.log('Recent Jobs:', jobs);
  }
}

verify();
