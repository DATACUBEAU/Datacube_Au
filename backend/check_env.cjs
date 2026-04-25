
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://dhmukdeljiwvvwjdcxgn.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobXVrZGVsaml3dnZ3amRjeGduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTIwNjAyOCwiZXhwIjoyMDgwNzgyMDI4fQ.3lrr0S4UH-9mccuIZAxn1TH82d-SezY19ny8OTaiS2o';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function checkBucketAndLogs() {
  console.log('--- Checking Buckets ---');
  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
  if (bucketError) console.error('Bucket Error:', bucketError);
  else {
    console.log('Buckets:', buckets.map(b => b.name));
    const docBucket = buckets.find(b => b.name === 'documents');
    if (!docBucket) console.error('CRITICAL: "documents" bucket missing!');
    else console.log('"documents" bucket exists.');
  }

  console.log('\n--- Checking Recent Debug Logs ---');
  const { data: logs, error: logError } = await supabase
    .from('au_debug_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (logError) console.error('Log Error:', logError);
  else console.table(logs);
}

checkBucketAndLogs();
