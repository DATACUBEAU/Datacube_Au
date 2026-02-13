'use client';

import { useEffect, useState } from 'react';
import { useSupabaseSession } from '@/hooks/use-supabase-auth';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ShieldAlert, LogIn, X } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function InactivityPolicyBanner() {
  const [session] = useSupabaseSession();
  const [isVisible, setIsVisible] = useState(false);
  const [userType, setUserType] = useState<'guest' | 'auth'>('guest');
  const router = useRouter();

  useEffect(() => {
    // Check if user has seen the policy
    const hasSeen = localStorage.getItem('au_policy_notice_seen_v1');
    if (!hasSeen) {
       setIsVisible(true);
    }

    if (session?.user) {
        setUserType('auth');
    } else {
        setUserType('guest');
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
              {userType === 'guest' ? (
                <>
                  Policy Update: Inactive guest accounts will be automatically deleted after <strong>24 HOURS</strong> to ensure data security. 
                  Sign in with Google to secure your data permanently.
                </>
              ) : (
                <>
                  Policy Update: Inactive accounts will be automatically deleted after <strong>14 DAYS</strong> to ensure data security. 
                  Sign in regularly to keep your account active.
                </>
              )}
            </AlertDescription>
          </div>
          <div className="flex flex-col gap-2 min-w-[140px]">
            {userType === 'guest' && (
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
