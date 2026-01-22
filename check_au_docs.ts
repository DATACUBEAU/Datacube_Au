import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dhmukdeljiwvvwjdcxgn.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobXVrZGVsaml3dnZ3amRjeGduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTIwNjAyOCwiZXhwIjoyMDgwNzgyMDI4fQ.3lrr0S4UH-9mccuIZAxn1TH82d-SezY19ny8OTaiS2o';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkAuDocuments() {
  console.log('--- CHECKING au_documents ---');
  const { data, error } = await supabase.from('au_documents').select('*').limit(1);
  if (error) {
    console.error('Error:', error.message);
  } else if (data && data.length > 0) {
    console.log('Columns:', Object.keys(data[0]));
  } else {
    console.log('No data in au_documents, trying to get columns via rpc if possible or just assuming missing name column');
    // Try to select a non-existent column to see if it lists columns in error or just fails
    const { error: nameError } = await supabase.from('au_documents').select('name').limit(1);
    console.log('name check error:', nameError?.message);
    
    const { error: filenameError } = await supabase.from('au_documents').select('file_name').limit(1);
    console.log('file_name check error:', filenameError?.message);

    const { error: titleError } = await supabase.from('au_documents').select('title').limit(1);
    console.log('title check error:', titleError?.message);
  }
}

checkAuDocuments();
