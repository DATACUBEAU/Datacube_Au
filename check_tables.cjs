const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://dhmukdeljiwvvwjdcxgn.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobXVrZGVsaml3dnZ3amRjeGduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTIwNjAyOCwiZXhwIjoyMDgwNzgyMDI4fQ.3lrr0S4UH-9mccuIZAxn1TH82d-SezY19ny8OTaiS2o';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const tables = ['au_documents', 'au_upload_jobs', 'au_guest_sessions'];

async function check() {
  console.log('Checking tables...');
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (error) {
      console.log(`Table ${table}: ERROR - ${error.message}`);
    } else {
      console.log(`Table ${table}: OK`);
      const { error: colError } = await supabase.from(table).select('id, metadata').limit(1);
      if (colError) {
        console.log(`  Columns check (id, metadata): FAILED - ${colError.message}`);
      } else {
        console.log(`  Columns check (id, metadata): OK`);
      }
    }
  }
}

check();
