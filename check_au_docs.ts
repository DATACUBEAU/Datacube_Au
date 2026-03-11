import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
}

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
