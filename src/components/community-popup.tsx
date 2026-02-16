'use client';

import { useEffect } from 'react';
import { useCommunityPopup } from '@/hooks/use-community-popup';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MessageCircle } from 'lucide-react';

export function CommunityPopup() {
  const { isOpen, markAsSeen, markAsJoined } = useCommunityPopup();

  const handleJoin = () => {
    // Open WhatsApp link
    window.open('https://chat.whatsapp.com/D7GGljLQitlFHRoEbBQsYO', '_blank');
    // Mark as joined
    markAsJoined();
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && markAsSeen()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="mx-auto w-12 h-12 bg-green-500/10 rounded-full flex items-center justify-center mb-4">
            <MessageCircle className="h-6 w-6 text-green-600" />
          </div>
          <DialogTitle className="text-center">Get updates faster</DialogTitle>
          <DialogDescription className="text-center pt-2">
            Join our WhatsApp community for updates, important info, and announcements directly from the team.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row gap-2 pt-4">
          <Button onClick={handleJoin} className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white">
            Join Community
          </Button>
          <Button variant="ghost" onClick={() => markAsSeen()} className="w-full sm:w-auto">
            Not now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
