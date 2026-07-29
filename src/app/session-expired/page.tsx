'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buildLoginReauthPath, sanitizeLocalRedirectPath } from '@/lib/auth/redirects';

export default function SessionExpiredPage() {
  const searchParams = useSearchParams();
  const nextPath = useMemo(
    () => sanitizeLocalRedirectPath(searchParams.get('next')),
    [searchParams],
  );
  const loginPath = useMemo(() => buildLoginReauthPath(nextPath), [nextPath]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="mb-2 rounded-full bg-primary/10 p-3 text-primary">
            <ShieldAlert className="h-6 w-6" aria-hidden="true" />
          </div>
          <CardTitle className="font-headline text-2xl">Your session has expired</CardTitle>
          <CardDescription>
            For your security, please sign in again to renew your session.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Button asChild className="w-full">
            <Link href={loginPath}>Re-authenticate</Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href="/">Return to home</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
