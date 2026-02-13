
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dhmukdeljiwvvwjdcxgn.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobXVrZGVsaml3dnZ3amRjeGduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTIwNjAyOCwiZXhwIjoyMDgwNzgyMDI4fQ.3lrr0S4UH-9mccuIZAxn1TH82d-SezY19ny8OTaiS2o';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  console.log('--- STARTING SCHEMA FIX ---');
  
  // Try to use a common RPC name for running SQL if it exists
  // If not, we'll have to rely on the migrations being applied correctly via CLI
  const sqlCommands = [
    `ALTER TABLE public.au_upload_jobs ADD COLUMN IF NOT EXISTS guest_session_id UUID REFERENCES public.au_guest_sessions(id) ON DELETE CASCADE;`,
    `ALTER TABLE public.au_upload_jobs ADD COLUMN IF NOT EXISTS error text;`,
    `CREATE INDEX IF NOT EXISTS au_upload_jobs_guest_session_id_idx ON au_upload_jobs(guest_session_id);`
  ];

  for (const sql of sqlCommands) {
    console.log(`Executing: ${sql}`);
    // Most Supabase setups don't have a public 'exec_sql' RPC for security reasons.
    // But sometimes it's added during development.
    const { error } = await supabase.rpc('exec_sql', { sql_query: sql });
    if (error) {
      console.warn(`RPC exec_sql failed (expected if not defined): ${error.message}`);
      break; 
    } else {
      console.log('Success!');
    }
  }

  console.log('\n--- CHECKING DOCUMENTS ---');
  const { data: docs, error: findError } = await supabase
    .from('au_documents')
    .select('id, file_name, file_path')
    .ilike('file_name', '%test_connection_auth%');

  if (findError) {
    console.error('Error finding documents:', findError.message);
  } else if (docs && docs.length > 0) {
    console.log(`Found ${docs.length} matching documents:`);
    for (const doc of docs) {
      console.log(`- Deleting ${doc.id} (${doc.file_name})`);
      
      if (doc.file_path) {
        const { error: storageError } = await supabase.storage.from('DataCube').remove([doc.file_path]);
        if (storageError) console.warn(`Storage delete error: ${storageError.message}`);
      }
      
      const { error: dbError } = await supabase.from('au_documents').delete().eq('id', doc.id);
      if (dbError) console.error(`DB delete error: ${dbError.message}`);
      else console.log('Successfully deleted from DB.');
    }
  } else {
    console.log('No "test_connection_auth" documents found.');
  }

  console.log('\n--- VERIFYING au_upload_jobs SCHEMA ---');
  const { data, error } = await supabase.from('au_upload_jobs').select('*').limit(1);
  if (error) {
    console.error('Schema Error on au_upload_jobs:', error.message);
    if (error.message.includes('column "guest_session_id" does not exist')) {
      console.error('CONFIRMED: guest_session_id is missing.');
    }
    if (error.message.includes('column "error" does not exist')) {
      console.error('CONFIRMED: error column is missing.');
    }
  } else {
    console.log('au_upload_jobs schema is healthy.');
  }
}

main();
