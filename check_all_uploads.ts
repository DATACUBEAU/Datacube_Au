
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkUploads() {
  console.log('--- LATEST 5 UPLOAD JOBS ---');
  const { data: jobs, error: jobsError } = await supabase
    .from('au_upload_jobs')
    .select('id, file_name, status, created_at, error')
    .order('created_at', { ascending: false })
    .limit(5);

  if (jobsError) console.error('Jobs Error:', jobsError.message);
  else console.table(jobs);

  console.log('\n--- LATEST 5 DOCUMENTS ---');
  const { data: docs, error: docsError } = await supabase
    .from('au_documents')
    .select('id, file_name, status, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  if (docsError) {
    console.error('Docs Error:', docsError.message);
  } else {
    console.table(docs);

    if (docs && docs.length > 0) {
      console.log('\n--- CHECKING CHUNKS FOR THESE DOCUMENTS ---');
      for (const doc of docs) {
        const { count, error: countError } = await supabase
          .from('au_document_chunks')
          .select('*', { count: 'exact', head: true })
          .eq('document_id', doc.id);

        if (countError) console.error(`Error counting chunks for ${doc.file_name}:`, countError.message);
        else console.log(`Document: ${doc.file_name} (ID: ${doc.id}) -> Chunks: ${count}`);
      }
    }
  }
}

checkUploads();
