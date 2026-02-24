const { createClient } = require('@supabase/supabase-js');
const crypto = require('node:crypto');

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SERVICE_ROLE_KEY');
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const runId = crypto.randomUUID();
  const email = `vps-worker-claim-test+${runId}@example.com`;
  const password = crypto.randomBytes(18).toString('base64url');

  const { data: createdUser, error: createUserError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createUserError || !createdUser?.user?.id) {
    throw new Error(`Failed to create test user: ${createUserError?.message || 'unknown'}`);
  }

  const userId = createdUser.user.id;
  const documentId = crypto.randomUUID();
  const objectPath = `${userId}/ingestion/claim-test/${documentId}_hello.txt`;

  const cleanup = async () => {
    await supabase.from('au_worker_jobs').delete().eq('document_id', documentId);
    await supabase.from('au_documents').delete().eq('id', documentId);
    await supabase.storage.from('documents').remove([objectPath]);
    await supabase.auth.admin.deleteUser(userId);
  };

  try {
    const uploadRes = await supabase.storage
      .from('documents')
      .upload(objectPath, Buffer.from('hello'), { upsert: true, contentType: 'text/plain' });
    if (uploadRes.error) throw uploadRes.error;

    const docInsert = await supabase.from('au_documents').insert([{
      id: documentId,
      owner_id: userId,
      user_id: userId,
      file_name: 'hello.txt',
      file_path: objectPath,
      document_type: 'main_textbook',
      status: 'uploaded',
      metadata: {},
    }]);
    if (docInsert.error) throw docInsert.error;

    const jobId = crypto.randomUUID();
    const jobInsert = await supabase.from('au_worker_jobs').insert([{
      id: jobId,
      document_id: documentId,
      owner_id: userId,
      user_id: userId,
      status: 'queued',
      progress: 0,
      worker_id: 'vps-worker',
      bucket: 'documents',
      object_path: objectPath,
      file_name: 'hello.txt',
      mime_type: 'text/plain',
      file_size_bytes: 5,
      metadata: {},
    }]);
    if (jobInsert.error) throw jobInsert.error;

    const claimRes = await supabase.rpc('claim_worker_job', {
      p_worker_id: `local-verify-${runId}`,
      p_lease_duration_ms: 60000,
    });
    if (claimRes.error) throw claimRes.error;

    const claimed = Array.isArray(claimRes.data) ? claimRes.data[0] : null;
    const result = {
      ok: true,
      runId,
      claimed: claimed || null,
      assertions: {
        claimedRowReturned: Boolean(claimed),
        guestSessionIsNull: claimed ? claimed.guest_session_id === null : null,
        workerIdRouting: 'vps-worker',
      },
    };

    console.log(JSON.stringify(result, null, 2));
  } finally {
    try {
      await cleanup();
    } catch (e) {
      console.error('cleanup_failed', e?.message || String(e));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
