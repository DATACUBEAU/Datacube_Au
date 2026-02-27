'use client';

import { useEffect, useState } from 'react';
import { useSupabaseSession } from '@/hooks/use-supabase-auth';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ShieldAlert, LogIn, X } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function InactivityPolicyBanner() {
  const { session } = useSupabaseSession();
  const [isVisible, setIsVisible] = useState(false);
  const router = useRouter();
  const isSignedIn = Boolean(session?.user);

  useEffect(() => {
    // Check if user has seen the policy
    const hasSeen = localStorage.getItem('au_policy_notice_seen_v1');
    if (!hasSeen) {
       setIsVisible(true);
    }

  }, [session]);

  const handleDismiss = () => {
      localStorage.setItem('au_policy_notice_seen_v1', 'true');
      setIsVisible(false);
  };

  const handleSignIn = () => {
    router.push('/login');
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Alert variant="destructive" className="border-2 border-red-500 bg-red-50 dark:bg-red-950 shadow-lg max-w-4xl mx-auto">
        <div className="flex items-start gap-4">
          <div className="p-2 bg-red-100 dark:bg-red-900 rounded-full">
            <ShieldAlert className="h-6 w-6 text-red-600 dark:text-red-400" />
          </div>
          <div className="flex-1">
            <AlertTitle className="text-red-800 dark:text-red-200 font-bold text-lg mb-1">
              Policy Update: Data Security Notice
            </AlertTitle>
            <AlertDescription className="text-red-700 dark:text-red-300 text-sm leading-relaxed">
              {isSignedIn ? (
                <>
                  If you stay signed out for <strong>7 DAYS</strong>, uploaded documents are deleted. If inactive for <strong>14 DAYS</strong>, uploaded documents and derived chunks/embeddings are deleted.
                </>
              ) : (
                <>
                  If you stay signed out for <strong>7 DAYS</strong>, uploaded documents are deleted. If inactive for <strong>14 DAYS</strong>, uploaded documents and derived chunks/embeddings are deleted.
                </>
              )}
            </AlertDescription>
          </div>
          <div className="flex flex-col gap-2 min-w-[140px]">
            {!isSignedIn && (
              <Button onClick={handleSignIn} size="sm" className="w-full bg-red-600 hover:bg-red-700 text-white border-none shadow-md">
                <LogIn className="mr-2 h-4 w-4" />
                Sign In Now
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleDismiss} className="w-full border-red-200 hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900">
              <X className="mr-2 h-4 w-4" />
              Dismiss
            </Button>
          </div>
        </div>
      </Alert>
    </div>
  );
}
