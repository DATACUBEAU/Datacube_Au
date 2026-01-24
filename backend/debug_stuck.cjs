
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://dhmukdeljiwvvwjdcxgn.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobXVrZGVsaml3dnZ3amRjeGduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTIwNjAyOCwiZXhwIjoyMDgwNzgyMDI4fQ.3lrr0S4UH-9mccuIZAxn1TH82d-SezY19ny8OTaiS2o';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function debugStuckJob() {
  console.log('--- Checking Stuck Jobs (Processing) ---');
  
  const { data: stuckJobs, error: jobError } = await supabase
    .from('au_upload_jobs')
    .select('*')
    .eq('status', 'processing')
    .order('updated_at', { ascending: false });

  if (jobError) console.error('Job Error:', jobError);
  else {
    console.log(`Found ${stuckJobs.length} stuck jobs.`);
    stuckJobs.forEach(j => {
      console.log(`- Job ${j.id}: ${j.file_name} (Progress: ${j.progress}%) - Updated: ${j.updated_at}`);
    });
  }

  console.log('\n--- Checking Recent Debug Logs ---');
  const { data: logs, error: logError } = await supabase
    .from('au_debug_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (logError) console.error('Log Error:', logError);
  else {
    logs.forEach(l => {
      console.log(`[${l.created_at}] ${l.component}: ${l.message}`);
      if (l.details) console.log(JSON.stringify(l.details, null, 2));
    });
  }
}

debugStuckJob();
