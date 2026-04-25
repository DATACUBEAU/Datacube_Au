
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const supabaseUrl = 'https://dhmukdeljiwvvwjdcxgn.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobXVrZGVsaml3dnZ3amRjeGduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTIwNjAyOCwiZXhwIjoyMDgwNzgyMDI4fQ.3lrr0S4UH-9mccuIZAxn1TH82d-SezY19ny8OTaiS2o';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function requeueStuckJobs() {
  console.log('--- Requeuing Processing Jobs ---');
  
  // 1. Find jobs stuck in processing
  const { data: stuckJobs, error: fetchError } = await supabase
    .from('au_upload_jobs')
    .select('id, status, file_name')
    .eq('status', 'processing');

  if (fetchError) {
    console.error('Error fetching stuck jobs:', fetchError);
    return;
  }

  if (!stuckJobs || stuckJobs.length === 0) {
    console.log('No jobs found in processing state.');
    return;
  }

  console.log(`Found ${stuckJobs.length} stuck jobs. Requeuing...`);

  // 2. Update them to queued
  for (const job of stuckJobs) {
    const { error: updateError } = await supabase
      .from('au_upload_jobs')
      .update({ status: 'queued', progress: 0 })
      .eq('id', job.id);

    if (updateError) {
      console.error(`Failed to requeue job ${job.id}:`, updateError);
    } else {
      console.log(`Requeued job ${job.id} (${job.file_name})`);
    }
  }
}

requeueStuckJobs();
