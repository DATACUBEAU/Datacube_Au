import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dhmukdeljiwvvwjdcxgn.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobXVrZGVsaml3dnZ3amRjeGduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTIwNjAyOCwiZXhwIjoyMDgwNzgyMDI4fQ.3lrr0S4UH-9mccuIZAxn1TH82d-SezY19ny8OTaiS2o';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkStatus() {
  console.log('--- CHECKING STATUS ---');

  // 1. Check if test_connection_auth.txt exists in au_documents
  console.log('\n1. Checking au_documents for test_connection_auth.txt...');
  const { data: docs, error: docError } = await supabase
    .from('au_documents')
    .select('id, name, user_id, guest_session_id')
    .ilike('name', '%test_connection_auth.txt%');

  if (docError) {
    console.error('Error fetching documents:', docError.message);
  } else if (docs && docs.length > 0) {
    console.log('Found documents:', docs);
  } else {
    console.log('No documents found matching "test_connection_auth.txt"');
  }

  // 2. Check au_upload_jobs schema
  console.log('\n2. Checking au_upload_jobs schema...');
  const { data: jobs, error: jobError } = await supabase
    .from('au_upload_jobs')
    .select('*')
    .limit(1);

  if (jobError) {
    console.log('Error selecting from au_upload_jobs:', jobError.message);
    if (jobError.message.includes('column "guest_session_id" does not exist')) {
      console.log('CONFIRMED: guest_session_id is missing.');
    }
    if (jobError.message.includes('column "error" does not exist')) {
      console.log('CONFIRMED: error column is missing.');
    }
  } else if (jobs && jobs.length > 0) {
    const columns = Object.keys(jobs[0]);
    console.log('Existing columns in au_upload_jobs:', columns);
    if (!columns.includes('guest_session_id')) console.log('MISSING: guest_session_id');
    if (!columns.includes('error')) console.log('MISSING: error');
  } else {
    // Try to select specifically
    const { error: guestError } = await supabase.from('au_upload_jobs').select('guest_session_id').limit(1);
    if (guestError) console.log('guest_session_id check error:', guestError.message);
    else console.log('guest_session_id exists.');

    const { error: errColError } = await supabase.from('au_upload_jobs').select('error').limit(1);
    if (errColError) console.log('error column check error:', errColError.message);
    else console.log('error column exists.');
  }

  // 3. Check if guest_sessions has an index on id (well, id is usually PK, so it has an index)
  // But maybe the user meant guest_session_id in other tables?
  // They said: "I recommend adding an index on guest_sessions.id" - which is redundant for PK.
  // Maybe they meant au_documents.guest_session_id?
  
  console.log('\n--- STATUS CHECK COMPLETE ---');
}

checkStatus();
