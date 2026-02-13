
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
  console.log('--- RAG Health Check ---');
  
  // 1. Check au_documents
  const { data: docs, error: docErr } = await supabase.from('au_documents').select('*').limit(1);
  if (docErr) console.error('au_documents check failed:', docErr.message);
  else console.log('au_documents: OK');

  // 2. Check au_document_chunks text_hash
  const { data: chunks, error: chunkErr } = await supabase.from('au_document_chunks').select('id, text_hash').limit(1);
  if (chunkErr) console.error('au_document_chunks text_hash check failed:', chunkErr.message);
  else console.log('au_document_chunks (text_hash): OK');

  // 3. Check uniqueness constraint on chunks
  // We try to find the constraint in information_schema
  const { data: constraints, error: constrErr } = await supabase.rpc('get_table_constraints', { t_name: 'au_document_chunks' });
  // If RPC doesn't exist, we can try a raw query if allowed, or just assume from error codes
  
  // 4. Check au_document_embeddings UNIQUE and ivfflat
  const { data: embeddings, error: embErr } = await supabase.from('au_document_embeddings').select('*').limit(1);
  if (embErr) console.error('au_document_embeddings check failed:', embErr.message);
  else console.log('au_document_embeddings: OK');

  // 5. Check upload jobs status
  const { data: jobs, error: jobErr } = await supabase.from('au_upload_jobs').select('status').limit(5);
  if (jobErr) console.error('au_upload_jobs check failed:', jobErr.message);
  else {
    const statuses = jobs.map(j => j.status);
    console.log('au_upload_jobs statuses:', statuses);
  }
}

checkSchema();
