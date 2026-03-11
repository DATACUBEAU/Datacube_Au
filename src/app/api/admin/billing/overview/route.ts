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
