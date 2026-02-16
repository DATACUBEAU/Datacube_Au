import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkFile() {
  const { data, error } = await supabase
    .from('au_documents')
    .select('id, file_name, user_id, guest_session_id')
    .ilike('file_name', '%test_connection_auth.txt%');

  if (error) {
    console.error('Error:', error.message);
  } else {
    console.log('Results:', data);
  }
}

checkFile();
