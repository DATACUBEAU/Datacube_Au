'use client';

import { Suspense, useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import {
  MOBILE_AUTH_APPROVAL_PATH,
  MOBILE_AUTH_RETURN_PATH,
  readMobileAuthorizationRequest,
} from '@/lib/auth/redirects';

type Decision = 'approve' | 'deny';
type DecisionStatus = 'approved' | 'denied';

function LoadingApproval() {
  return (
    <p role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
      Checking your sign-in…
    </p>
  );
}

function ApprovalRequest({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [user, session, loading] = useSupabaseUser();
  const [pairingCode, setPairingCode] = useState('');
  const [pending, setPending] = useState<Decision | null>(null);
  const [result, setResult] = useState<DecisionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const approvalPath = `${MOBILE_AUTH_APPROVAL_PATH}?request=${requestId}`;
  const loginPath = `/login?redirectTo=${encodeURIComponent(approvalPath)}`;

  useEffect(() => {
    if (!loading && !session && !result) router.replace(loginPath);
  }, [loading, loginPath, result, router, session]);

  async function sendDecision(action: Decision) {
    if (pending || !session?.access_token || result) return;
    const code = pairingCode.toUpperCase().replace(/[\s-]/g, '');
    if (!/^[A-Z2-9]{8}$/.test(code)) {
      setError('Enter the eight-character code shown in the DataCube AU app.');
      return;
    }

    setPending(action);
    setError(null);
    try {
      const response = await fetch('/api/auth/mobile-authorization', {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'origin',
        signal: AbortSignal.timeout(20_000),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action, requestId, pairingCode: code }),
      });

      if (response.status === 401) {
        setPairingCode('');
        router.replace(`${loginPath}&forceReauth=1&reason=session_expired`);
        return;
      }
      if (response.status === 409) {
        setError('This sign-in request could not be matched. Check the code or open DataCube AU to continue.');
        return;
      }
      if (response.status === 429) {
        setError('Too many attempts. Wait a moment and try again.');
        return;
      }
      const payload = response.ok ? await response.json() : null;
      const expectedStatus = action === 'approve' ? 'approved' : 'denied';
      if (payload?.ok !== true || payload.status !== expectedStatus) {
        setError('Your choice could not be saved. Try again or open DataCube AU to continue.');
        return;
      }
      setPairingCode('');
      setResult(expectedStatus);
    } catch {
      setError('Your choice could not be confirmed. Check your connection or open DataCube AU to continue.');
    } finally {
      setPending(null);
    }
  }

  if (result === 'approved') {
    return (
      <div className="space-y-4" aria-live="polite">
        <h1 className="text-2xl font-semibold">{"You're authenticated!"}</h1>
        <p className="text-sm text-muted-foreground">
          Your DataCube AU app is ready. Return to the app to continue.
        </p>
        <Button asChild className="min-h-11 w-full">
          <a href={`${MOBILE_AUTH_RETURN_PATH}?request=${requestId}`}>Open DataCube AU</a>
        </Button>
        <p className="text-sm text-muted-foreground">
          If the link doesn’t open the app, reopen DataCube AU from your home screen.
        </p>
      </div>
    );
  }

  if (result === 'denied') {
    return (
      <div className="space-y-3" aria-live="polite">
        <h1 className="text-2xl font-semibold">Sign-in denied</h1>
        <p className="text-sm text-muted-foreground">Reopen DataCube AU to start again.</p>
      </div>
    );
  }

  if (loading || !session) return <LoadingApproval />;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Approve app sign-in</h1>
        <p className="text-sm text-muted-foreground">
          Enter the code shown in the DataCube AU app, then choose whether to approve this sign-in.
        </p>
        {user?.email && <p className="break-all text-sm font-medium">Signed in as {user.email}</p>}
      </div>
      <div className="space-y-2 text-left">
        <Label htmlFor="pairing-code">Pairing code</Label>
        <Input
          id="pairing-code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          maxLength={16}
          value={pairingCode}
          onChange={(event) => {
            setPairingCode(event.currentTarget.value.toUpperCase());
            setError(null);
          }}
          disabled={pending !== null}
          aria-describedby={error ? 'mobile-approval-error' : undefined}
          className="font-mono tracking-widest"
        />
      </div>
      {error && <p id="mobile-approval-error" role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="button" onClick={() => void sendDecision('approve')} disabled={pending !== null} className="min-h-11">
          {pending === 'approve' ? 'Approving…' : 'Approve sign-in'}
        </Button>
        <Button type="button" onClick={() => void sendDecision('deny')} disabled={pending !== null} variant="outline" className="min-h-11">
          {pending === 'deny' ? 'Denying…' : 'Deny sign-in'}
        </Button>
      </div>
    </div>
  );
}

function ApprovalContent() {
  const requestId = readMobileAuthorizationRequest(useSearchParams());
  return requestId ? (
    <ApprovalRequest key={requestId} requestId={requestId} />
  ) : (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Open DataCube AU to sign in</h1>
      <p className="text-sm text-muted-foreground">Reopen the app and start sign-in again.</p>
    </div>
  );
}

export default function MobileAuthApprovePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10 text-center">
      <section className="w-full max-w-sm space-y-5 rounded-2xl border border-white/10 bg-card p-7 shadow-xl">
        <Image src="/icon.svg" alt="DataCube AU" width={64} height={64} className="mx-auto rounded-xl" />
        <Suspense fallback={<LoadingApproval />}>
          <ApprovalContent />
        </Suspense>
      </section>
    </main>
  );
}
