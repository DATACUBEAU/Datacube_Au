import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { isProtectedOwnerUserId } from '@/lib/admin/protected-owner';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

/**
 * Account deletion API route.
 *
 * Flow:
 *   1. Verify user identity (server-authoritative — no client-side trust)
 *   2. Log deletion request in audit trail
 *   3. Soft-delete: mark account as pending deletion
 *   4. Immediately revoke sessions + entitlements
 *   5. Queue cleanup of user data (documents, chunks, embeddings, activity)
 *   6. Remove Supabase auth user (permanent)
 */
export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const supabase = createSupabaseAdminClient();

  try {
    // 1. Server-authoritative identity verification
    const auth = await requireUserFromRequest(req);
    if (!auth.ok) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'Authentication required.', requestId },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const userId = auth.userId;
    const userEmail = auth.email || 'unknown';
    if (isProtectedOwnerUserId(userId)) {
      return NextResponse.json(
        {
          error: 'protected_owner_account',
          message: 'The protected platform owner account cannot be deleted.',
          requestId,
        },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // Parse body for confirmation token
    const body = await req.json().catch(() => ({}));
    const confirmation = String(body?.confirmation || '').trim();

    // Require explicit confirmation string
    if (confirmation !== 'DELETE MY ACCOUNT') {
      return NextResponse.json(
        {
          error: 'confirmation_required',
          message: 'You must type "DELETE MY ACCOUNT" to confirm.',
          requestId,
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    console.log(`[account-delete] Deletion requested for user=${userId} email=${userEmail}`);

    // Helper: safely execute a query — non-blocking on table-not-found
    async function safeExec<T>(fn: () => PromiseLike<{ error: any; data?: T }>) {
      try {
        const result = await fn();
        return result;
      } catch {
        return { error: null, data: undefined as T | undefined };
      }
    }

    // 2. Audit log — record the deletion request BEFORE any data is removed
    await safeExec(() =>
      supabase.from('au_activity_log').insert({
        event_name: 'account_deletion_requested',
        event_params: { userId, email: userEmail, requestId },
        user_id: userId,
        created_at: new Date().toISOString(),
      }),
    );

    // 3. Soft-delete user profile
    await safeExec(() =>
      supabase
        .from('au_user_profiles')
        .update({
          tier: 'deleted',
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId),
    );

    // 4. Cancel active subscriptions
    await safeExec(() =>
      supabase
        .from('billing_subscriptions')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancel_reason: 'account_deletion',
        })
        .eq('user_id', userId)
        .in('status', ['active', 'trialing']),
    );

    // 5. Revoke entitlements
    await safeExec(() =>
      supabase
        .from('au_user_entitlements')
        .update({
          is_active: false,
          revoked_at: new Date().toISOString(),
          revoke_reason: 'account_deletion',
        })
        .eq('user_id', userId),
    );

    // 6. Delete user data in order of dependency
    const deletionResults: Record<string, { ok: boolean; error?: string }> = {};

    // 6a. Delete worker jobs
    const jobsRes = await safeExec(() =>
      supabase.from('au_worker_jobs').delete().eq('user_id', userId),
    );
    deletionResults.worker_jobs = { ok: !jobsRes.error, error: jobsRes.error?.message };

    // 6b. Delete document chunks
    const chunksRes = await safeExec(() =>
      supabase.from('au_document_chunks').delete().eq('user_id', userId),
    );
    deletionResults.document_chunks = { ok: !chunksRes.error, error: chunksRes.error?.message };

    // 6c. Delete documents (cascade will handle remaining refs)
    const docsRes = await safeExec(() =>
      supabase.from('au_documents').delete().eq('user_id', userId),
    );
    deletionResults.documents = { ok: !docsRes.error, error: docsRes.error?.message };

    // 6d. Delete chat messages
    const msgsRes = await safeExec(() =>
      supabase.from('au_messages').delete().eq('user_id', userId),
    );
    deletionResults.messages = { ok: !msgsRes.error, error: msgsRes.error?.message };

    // 6e. Delete chat threads
    const threadsRes = await safeExec(() =>
      supabase.from('au_chat_threads').delete().eq('user_id', userId),
    );
    deletionResults.chat_threads = { ok: !threadsRes.error, error: threadsRes.error?.message };

    // 6f. Delete feature outputs (knowledge, predictions, exams)
    const outputsRes = await safeExec(() =>
      supabase.from('au_feature_outputs').delete().eq('user_id', userId),
    );
    deletionResults.feature_outputs = { ok: !outputsRes.error, error: outputsRes.error?.message };

    // 6g. Delete activity logs
    const activityRes = await safeExec(() =>
      supabase.from('au_activity_log').delete().eq('user_id', userId),
    );
    deletionResults.activity_log = { ok: !activityRes.error, error: activityRes.error?.message };

    // 6h-m. Clean up remaining tables (non-critical — best-effort)
    await safeExec(() => supabase.from('au_usage_daily').delete().eq('owner_id', userId));
    await safeExec(() => supabase.from('au_limit_usage').delete().eq('user_id', userId));
    await safeExec(() => supabase.from('au_feedback').delete().eq('user_id', userId));
    await safeExec(() => supabase.from('au_user_profiles').delete().eq('user_id', userId));
    await safeExec(() => supabase.from('billing_subscriptions').delete().eq('user_id', userId));
    await safeExec(() => supabase.from('au_user_entitlements').delete().eq('user_id', userId));

    // 7. Delete storage files
    try {
      const bucketName = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'documents';
      const { data: files } = await supabase.storage
        .from(bucketName)
        .list(`uploads/${userId}`);

      if (files && files.length > 0) {
        const paths = files.map((f: any) => `uploads/${userId}/${f.name}`);
        await supabase.storage.from(bucketName).remove(paths);
      }
    } catch (storageErr: any) {
      console.warn('[account-delete] Storage cleanup error (non-fatal):', storageErr?.message);
    }

    // 8. Delete the auth user (permanent — point of no return)
    const { error: authDeleteErr } = await supabase.auth.admin.deleteUser(userId);
    if (authDeleteErr) {
      console.error('[account-delete] Auth user deletion failed:', authDeleteErr.message);
      return NextResponse.json(
        {
          ok: false,
          error: 'partial_deletion',
          message: 'Account data was removed but auth record could not be deleted. Contact support.',
          requestId,
          deletionResults,
        },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    console.log(`[account-delete] Account fully deleted: user=${userId}`);

    return NextResponse.json(
      {
        ok: true,
        message: 'Your account has been permanently deleted.',
        requestId,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    console.error('[account-delete] Unexpected error:', error?.message || error);
    return NextResponse.json(
      {
        error: 'deletion_failed',
        message: 'Account deletion failed. Please try again or contact support.',
        requestId,
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
