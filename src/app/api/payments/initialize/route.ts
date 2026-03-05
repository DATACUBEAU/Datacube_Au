import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/app/api/proxy/_supabase-auth';
import { createCheckout } from '@/lib/server/billing';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';

const REQUEST_COOLDOWN_MS = 2500;
const requestLimiter = new Map<string, number>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const last = requestLimiter.get(key) || 0;
  if (now - last < REQUEST_COOLDOWN_MS) {
    return true;
  }
  requestLimiter.set(key, now);
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUserFromRequest(req);
    if (!auth.ok) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    if (isRateLimited(`checkout:${auth.userId}`)) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'High demand / rate limited - retry shortly.' },
        {
          status: 429,
          headers: { 'Retry-After': '3' },
        }
      );
    }

    const body = await req.json().catch(() => ({}));
    const planKey = String((body as any)?.plan_key || '');
    const paymentMethod = (body as any)?.payment_method;
    const supabase = createSupabaseAdminClient();

    let email = auth.email;
    if (!email) {
      const userResult = await supabase.auth.admin.getUserById(auth.userId);
      if (userResult.error || !userResult.data?.user?.email) {
        return NextResponse.json(
          { error: 'missing_email', message: 'Unable to resolve account email for checkout.' },
          { status: 400 }
        );
      }
      email = userResult.data.user.email;
    }

    const result = await createCheckout({
      supabase,
      userId: auth.userId,
      email,
      planKeyRaw: planKey,
      paymentMethodRaw: paymentMethod,
      origin: req.nextUrl.origin,
    });

    return NextResponse.json(
      {
        status: 'ok',
        authorization_url: result.authorizationUrl,
        reference: result.reference,
      },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: 'checkout_failed', message: String(error?.message || 'Checkout failed.') },
      { status: 400 }
    );
  }
}
