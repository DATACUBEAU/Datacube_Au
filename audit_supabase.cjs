const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Try to load .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function audit() {
  const tables = ['au_documents', 'au_sessions', 'au_messages', 'au_document_chunks', 'au_guest_sessions', 'au_upload_jobs'];
  console.log('--- TABLE AUDIT ---');
  for (const table of tables) {
    try {
      const { data, error } = await supabase.from(table).select('*').limit(1);
      if (error) {
        console.log(`Table ${table}: ERROR - ${error.message} (${error.code})`);
      } else {
        const columns = data && data.length > 0 ? Object.keys(data[0]) : 'Empty table (or no data to infer columns)';
        console.log(`Table ${table}: OK - Columns: ${Array.isArray(columns) ? columns.join(', ') : columns}`);
      }
    } catch (e) {
      console.log(`Table ${table}: EXCEPTION - ${e.message}`);
    }
  }
}
audit();
