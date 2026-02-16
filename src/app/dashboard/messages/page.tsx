'use client';

import { useState } from 'react';
import { useCommunityPopup } from '@/hooks/use-community-popup';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function MessagesPage() {
  const { isJoined, markAsJoined } = useCommunityPopup();
  const [showRejoinConfirm, setShowRejoinConfirm] = useState(false);

  const openWhatsApp = () => {
    window.open('https://chat.whatsapp.com/D7GGljLQitlFHRoEbBQsYO', '_blank');
    markAsJoined();
  };

  const handleJoinClick = () => {
    if (isJoined) {
      setShowRejoinConfirm(true);
    } else {
      openWhatsApp();
    }
  };

  return (
    <div className="container mx-auto max-w-4xl py-8 px-4">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-headline text-3xl font-semibold">Messages & Updates</h1>
          <p className="text-muted-foreground mt-2">
            Stay connected with the DataCube AU community and get the latest announcements.
          </p>
        </div>

        <Card className="border-l-4 border-l-green-600 shadow-md">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-full">
                <MessageCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <CardTitle className="text-xl">WhatsApp Community</CardTitle>
                <CardDescription>
                  Official channel for updates, support, and discussions.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
              <div className="space-y-2 max-w-xl">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Join our WhatsApp community to receive instant notifications about system updates, maintenance alerts, and tips on how to get the most out of DataCube AU.
                </p>
                {isJoined && (
                  <div className="flex items-center gap-2 text-sm font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/10 p-2 rounded-md w-fit">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>You have joined this community</span>
                  </div>
                )}
              </div>
              
              <Button 
                onClick={handleJoinClick}
                className={`min-w-[160px] ${
                  isJoined 
                    ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80' 
                    : 'bg-green-600 hover:bg-green-700 text-white'
                }`}
              >
                {isJoined ? (
                  <>Open Community <ArrowRight className="ml-2 h-4 w-4" /></>
                ) : (
                  <>Join Now <ArrowRight className="ml-2 h-4 w-4" /></>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={showRejoinConfirm} onOpenChange={setShowRejoinConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Already Joined?</AlertDialogTitle>
            <AlertDialogDescription>
              If you have already joined, there is no need to click this again. But if not, feel free to carry on.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setShowRejoinConfirm(false);
              openWhatsApp();
            }}>
              Carry On
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
