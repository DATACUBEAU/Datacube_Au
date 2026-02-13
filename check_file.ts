import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dhmukdeljiwvvwjdcxgn.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobXVrZGVsaml3dnZ3amRjeGduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTIwNjAyOCwiZXhwIjoyMDgwNzgyMDI4fQ.3lrr0S4UH-9mccuIZAxn1TH82d-SezY19ny8OTaiS2o';

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
