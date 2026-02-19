import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ForbiddenPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>403 Forbidden</CardTitle>
          <CardDescription>You are signed in but do not have access to this page.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button asChild>
            <Link href="/dashboard">Go to Dashboard</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/login">Sign In with Another Account</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

