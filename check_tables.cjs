const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const tables = ['au_documents', 'au_upload_jobs'];

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
