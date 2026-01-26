const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://dhmukdeljiwvvwjdcxgn.supabase.co';
// Using service role key for audit to bypass RLS and see reality
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobXVrZGVsaml3dnZ3amRjeGduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTIwNjAyOCwiZXhwIjoyMDgwNzgyMDI4fQ.3lrr0S4UH-9mccuIZAxn1TH82d-SezY19ny8OTaiS2o';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const tablesToCheck = [
  'au_documents',
  'au_document_chunks',
  'au_document_embeddings',
  'au_sessions',
  'au_messages',
  'au_guest_sessions',
  'au_upload_jobs',
  'au_api_keys',
  'au_rag_settings',
  'au_openrouter_config',
  'au_user_activity',
  'au_debug_logs'
];

async function runAudit() {
  console.log('🧠 PHASE 1 — BACKEND AUDIT REPORT\n');

  // 1. TABLES & COUNTS
  console.log('--- DATABASE TABLES & COUNTS ---');
  for (const table of tablesToCheck) {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`❌ ${table}: ERROR - ${error.message}`);
    } else {
      console.log(`✅ ${table}: ${count} rows`);
    }
  }

  // 2. ORPHANED DATA CHECK
  console.log('\n--- ORPHANED DATA CHECK ---');
  
  // Documents without users or guest sessions
  const { count: orphanedDocs, error: docError } = await supabase
    .from('au_documents')
    .select('*', { count: 'exact', head: true })
    .is('user_id', null)
    .is('guest_session_id', null);
  
  if (!docError) {
    if (orphanedDocs > 0) console.log(`⚠️  ${orphanedDocs} documents have NO user_id and NO guest_session_id (Orphaned)`);
    else console.log(`✅ No orphaned documents found.`);
  }

  // Messages without sessions
  // (Assuming referential integrity might enforce this, but checking anyway)
  const { count: orphanedMsgs, error: msgError } = await supabase
    .from('au_messages')
    .select('*', { count: 'exact', head: true })
    .is('session_id', null);
  
  if (!msgError) {
    if (orphanedMsgs > 0) console.log(`⚠️  ${orphanedMsgs} messages have NO session_id (Orphaned)`);
    else console.log(`✅ No orphaned messages found.`);
  }

  // 3. STORAGE BUCKETS
  console.log('\n--- STORAGE BUCKETS ---');
  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
  if (bucketError) {
    console.log(`❌ Error listing buckets: ${bucketError.message}`);
  } else {
    if (buckets.length === 0) {
        console.log('⚠️  No storage buckets found!');
    }
    for (const bucket of buckets) {
      console.log(`📦 Bucket: ${bucket.name} (Public: ${bucket.public})`);
      // List a few files
      const { data: files } = await supabase.storage.from(bucket.name).list(null, { limit: 5 });
      if (files && files.length > 0) {
          console.log(`   - Sample files: ${files.map(f => f.name).join(', ')}`);
      } else {
          console.log(`   - (Empty or no files at root)`);
      }
    }
  }

  // 4. AUTH USERS (Approximate via recent activity or just count if possible)
  // Service role can list users
  console.log('\n--- AUTH USERS ---');
  const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();
  if (authError) {
    console.log(`❌ Error listing users: ${authError.message}`);
  } else {
    console.log(`👤 Total Users: ${users.length}`);
    users.slice(0, 5).forEach(u => console.log(`   - ${u.email} (Last Sign-in: ${u.last_sign_in_at})`));
  }

  console.log('\n--- AUDIT COMPLETE ---');
}

runAudit();
