import { NextRequest, NextResponse } from 'next/server';
import { requireConexAdmin } from '@/app/api/feedback/_auth';

export const runtime = 'nodejs';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  try {
    const supabase = adminResult.supabase;
    const [
      { data: transactions, error: transactionsError },
      { data: subscriptions, error: subscriptionsError },
      { data: audit, error: auditError },
    ] = await Promise.all([
      supabase
        .from('billing_transactions')
        .select('reference,status,amount_kobo,channel,paid_at,created_at,user_id')
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('billing_subscriptions')
        .select('user_id,plan_key,status,starts_at,ends_at,cancel_at_period_end,updated_at')
        .order('updated_at', { ascending: false })
        .limit(30),
      supabase
        .from('entitlement_audit')
        .select('user_id,action,source,created_at,trace_id')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    if (transactionsError) throw transactionsError;
    if (subscriptionsError) throw subscriptionsError;
    if (auditError) throw auditError;

    const cancellationFeedbackResult = await supabase
      .from('billing_cancellation_feedback')
      .select('id,user_id,plan_key,subscription_status,gateway,cancellation_mode,cancellation_reason,context,created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200);
    const cancellationFeedbackError = cancellationFeedbackResult.error;
    const cancellationFeedbackCode = String((cancellationFeedbackError as any)?.code || '');
    const cancellationFeedbackMessage = String((cancellationFeedbackError as any)?.message || '').toLowerCase();
    const feedbackTableMissing =
      cancellationFeedbackCode === '42P01' ||
      cancellationFeedbackMessage.includes('does not exist') ||
      cancellationFeedbackMessage.includes('relation') && cancellationFeedbackMessage.includes('billing_cancellation_feedback');
    if (cancellationFeedbackError && !feedbackTableMissing) {
      throw cancellationFeedbackError;
    }
    const cancellationFeedback = feedbackTableMissing
      ? []
      : (cancellationFeedbackResult.data || []);

    return NextResponse.json(
      {
        ok: true,
        requestId,
        transactions: transactions || [],
        subscriptions: subscriptions || [],
        entitlementAudit: audit || [],
        cancellationFeedback: cancellationFeedback || [],
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: 'billing_overview_failed',
        message: String(error?.message || 'Failed to load overview.'),
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

/**
 * POST — Admin billing cleanup actions.
 *
 * Supported actions:
 *   - delete_transaction    { reference: string }
 *   - delete_subscription   { user_id: string, plan_key: string }
 *   - delete_entitlement    { user_id: string, trace_id?: string, created_at?: string }
 *   - clear_transactions    { confirmation: 'CONFIRM' }
 *   - clear_subscriptions   { confirmation: 'CONFIRM' }
 *   - clear_entitlements    { confirmation: 'CONFIRM' }
 *   - clear_all             { confirmation: 'CONFIRM DELETE ALL BILLING DATA' }
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  const supabase = adminResult.supabase;
  const body = await req.json().catch(() => ({}));
  const action = String((body as any)?.action || '').trim();

  if (!action) {
    return NextResponse.json(
      { ok: false, error: 'missing_action', message: 'Action is required.', requestId },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    switch (action) {
      case 'delete_transaction': {
        const reference = String((body as any)?.reference || '').trim();
        if (!reference) {
          return NextResponse.json(
            { ok: false, error: 'missing_reference', message: 'Transaction reference is required.', requestId },
            { status: 400, headers: { 'Cache-Control': 'no-store' } },
          );
        }
        const { error } = await supabase
          .from('billing_transactions')
          .delete()
          .eq('reference', reference);
        if (error) throw error;
        return NextResponse.json(
          { ok: true, action, reference, requestId },
          { status: 200, headers: { 'Cache-Control': 'no-store' } },
        );
      }

      case 'delete_subscription': {
        const userId = String((body as any)?.user_id || '').trim();
        const planKey = String((body as any)?.plan_key || '').trim();
        if (!userId) {
          return NextResponse.json(
            { ok: false, error: 'missing_user_id', message: 'User ID is required.', requestId },
            { status: 400, headers: { 'Cache-Control': 'no-store' } },
          );
        }
        let query = supabase.from('billing_subscriptions').delete().eq('user_id', userId);
        if (planKey) query = query.eq('plan_key', planKey);
        const { error } = await query;
        if (error) throw error;
        return NextResponse.json(
          { ok: true, action, user_id: userId, plan_key: planKey || null, requestId },
          { status: 200, headers: { 'Cache-Control': 'no-store' } },
        );
      }

      case 'delete_entitlement': {
        const userId = String((body as any)?.user_id || '').trim();
        const traceId = String((body as any)?.trace_id || '').trim();
        const createdAt = String((body as any)?.created_at || '').trim();
        if (!userId) {
          return NextResponse.json(
            { ok: false, error: 'missing_user_id', message: 'User ID is required.', requestId },
            { status: 400, headers: { 'Cache-Control': 'no-store' } },
          );
        }
        let query = supabase.from('entitlement_audit').delete().eq('user_id', userId);
        if (traceId) query = query.eq('trace_id', traceId);
        if (createdAt) query = query.eq('created_at', createdAt);
        const { error } = await query;
        if (error) throw error;
        return NextResponse.json(
          { ok: true, action, user_id: userId, requestId },
          { status: 200, headers: { 'Cache-Control': 'no-store' } },
        );
      }

      case 'clear_transactions': {
        if (String((body as any)?.confirmation || '') !== 'CONFIRM') {
          return NextResponse.json(
            { ok: false, error: 'confirmation_required', message: 'Set confirmation to "CONFIRM" to proceed.', requestId },
            { status: 400, headers: { 'Cache-Control': 'no-store' } },
          );
        }
        // Delete all rows — neq on a UUID guarantees all rows match
        const { error } = await supabase
          .from('billing_transactions')
          .delete()
          .neq('reference', '00000000-never-matches');
        if (error) throw error;
        return NextResponse.json(
          { ok: true, action, requestId },
          { status: 200, headers: { 'Cache-Control': 'no-store' } },
        );
      }

      case 'clear_subscriptions': {
        if (String((body as any)?.confirmation || '') !== 'CONFIRM') {
          return NextResponse.json(
            { ok: false, error: 'confirmation_required', message: 'Set confirmation to "CONFIRM" to proceed.', requestId },
            { status: 400, headers: { 'Cache-Control': 'no-store' } },
          );
        }
        const { error } = await supabase
          .from('billing_subscriptions')
          .delete()
          .neq('user_id', '00000000-0000-0000-0000-000000000000');
        if (error) throw error;
        return NextResponse.json(
          { ok: true, action, requestId },
          { status: 200, headers: { 'Cache-Control': 'no-store' } },
        );
      }

      case 'clear_entitlements': {
        if (String((body as any)?.confirmation || '') !== 'CONFIRM') {
          return NextResponse.json(
            { ok: false, error: 'confirmation_required', message: 'Set confirmation to "CONFIRM" to proceed.', requestId },
            { status: 400, headers: { 'Cache-Control': 'no-store' } },
          );
        }
        const { error } = await supabase
          .from('entitlement_audit')
          .delete()
          .neq('user_id', '00000000-0000-0000-0000-000000000000');
        if (error) throw error;
        return NextResponse.json(
          { ok: true, action, requestId },
          { status: 200, headers: { 'Cache-Control': 'no-store' } },
        );
      }

      case 'clear_all': {
        if (String((body as any)?.confirmation || '') !== 'CONFIRM DELETE ALL BILLING DATA') {
          return NextResponse.json(
            { ok: false, error: 'confirmation_required', message: 'Set confirmation to "CONFIRM DELETE ALL BILLING DATA".', requestId },
            { status: 400, headers: { 'Cache-Control': 'no-store' } },
          );
        }
        const results: Record<string, boolean> = {};
        const txnRes = await supabase.from('billing_transactions').delete().neq('reference', '00000000-never-matches');
        results.transactions = !txnRes.error;
        const subRes = await supabase.from('billing_subscriptions').delete().neq('user_id', '00000000-0000-0000-0000-000000000000');
        results.subscriptions = !subRes.error;
        const auditRes = await supabase.from('entitlement_audit').delete().neq('user_id', '00000000-0000-0000-0000-000000000000');
        results.entitlements = !auditRes.error;
        return NextResponse.json(
          { ok: true, action, results, requestId },
          { status: 200, headers: { 'Cache-Control': 'no-store' } },
        );
      }

      default:
        return NextResponse.json(
          { ok: false, error: 'unknown_action', message: `Unknown action: ${action}`, requestId },
          { status: 400, headers: { 'Cache-Control': 'no-store' } },
        );
    }
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: 'billing_action_failed', message: String(error?.message || 'Operation failed.'), requestId },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const adminResult = await requireConexAdmin(req);
  if (!adminResult.ok) return adminResult.response;

  const body = await req.json().catch(() => ({}));
  const id = String((body as any)?.id || '').trim();
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: 'invalid_feedback_id',
        message: 'A valid feedback id is required.',
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const supabase = adminResult.supabase;
    const deletedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from('billing_cancellation_feedback')
      .update({
        deleted_at: deletedAt,
        deleted_by: adminResult.auth.userId,
      })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();

    if (error) {
      const code = String((error as any)?.code || '');
      const message = String((error as any)?.message || '').toLowerCase();
      if (
        code === '42P01' ||
        message.includes('does not exist') ||
        (message.includes('relation') && message.includes('billing_cancellation_feedback'))
      ) {
        return NextResponse.json(
          {
            ok: false,
            requestId,
            error: 'feedback_table_missing',
            message: 'Cancellation feedback storage is not available yet. Run latest migrations.',
          },
          { status: 503, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      throw error;
    }
    if (!data) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: 'feedback_not_found',
          message: 'Cancellation feedback was not found or has already been deleted.',
        },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        requestId,
        id: String((data as any)?.id || id),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: 'billing_feedback_delete_failed',
        message: String(error?.message || 'Failed to delete cancellation feedback.'),
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
