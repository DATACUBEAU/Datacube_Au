'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles, Heart, MessageCircle, Info } from 'lucide-react';
import { motion } from 'framer-motion';

interface AUThrottlingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContactSupport: () => void;
}

export function AUThrottlingDialog({ open, onOpenChange, onContactSupport }: AUThrottlingDialogProps) {
  // We use a separate state to track if we've already shown it in this session
  // even if 'open' is passed as true multiple times.
  const [hasShownInSession, setHasShownInSession] = useState(false);

  useEffect(() => {
    if (open && !sessionStorage.getItem('au_throttling_dialog_seen')) {
      setHasShownInSession(false);
    } else if (open) {
      setHasShownInSession(true);
    }
  }, [open]);

  const handleClose = (newOpen: boolean) => {
    if (!newOpen) {
      sessionStorage.setItem('au_throttling_dialog_seen', 'true');
    }
    onOpenChange(newOpen);
  };

  // If we've already shown it this session, we don't render anything
  // even if the parent tries to open it.
  if (hasShownInSession && open) {
    onOpenChange(false);
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] border-primary/20 bg-background/95 backdrop-blur-md">
        <DialogHeader className="space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <motion.div
              animate={{ 
                scale: [1, 1.2, 1],
                opacity: [1, 0.8, 1]
              }}
              transition={{ 
                duration: 3, 
                repeat: Infinity, 
                ease: "easeInOut" 
              }}
            >
              <Sparkles className="w-8 h-8 text-primary" />
            </motion.div>
          </div>
          <DialogTitle className="text-center font-headline text-2xl uppercase tracking-tight text-primary">
            Hey there! ✨
          </DialogTitle>
          <DialogDescription className="text-center text-lg pt-2 text-foreground/90 font-medium">
            Our AI assistant is a bit busy right now, so some responses may be delayed.
          </DialogDescription>
        </DialogHeader>

        <div className="py-6">
          <p className="text-center text-muted-foreground leading-relaxed">
            If you enjoy the experience and want faster, uninterrupted support, consider supporting Datacube AU. Support helps Zahed Investment Ltd keep AU running smoothly and improve features for everyone.
          </p>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-3">
          <Button 
            variant="outline" 
            onClick={() => handleClose(false)} 
            className="flex-1 uppercase font-bold tracking-tighter"
          >
            Maybe Later
          </Button>
          <Button 
            onClick={() => {
              handleClose(false);
              onContactSupport();
            }} 
            className="flex-1 font-bold uppercase tracking-tighter shadow-lg shadow-primary/20 gap-2"
          >
            <Heart className="h-4 w-4 fill-current" />
            Support Datacube AU
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
