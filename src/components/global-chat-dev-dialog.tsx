'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Globe, Sparkles, MessageCircle, Info } from 'lucide-react';
import { motion } from 'framer-motion';

interface GlobalChatDevDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContactSupport: () => void;
}

export function GlobalChatDevDialog({ open, onOpenChange, onContactSupport }: GlobalChatDevDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] border-primary/20 bg-background/95 backdrop-blur-md">
        <DialogHeader className="space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <motion.div
              animate={{ 
                rotate: [0, 360],
                scale: [1, 1.1, 1]
              }}
              transition={{ 
                rotate: { duration: 20, repeat: Infinity, ease: "linear" },
                scale: { duration: 2, repeat: Infinity, ease: "easeInOut" }
              }}
            >
              <Globe className="w-8 h-8 text-primary" />
            </motion.div>
          </div>
          <DialogTitle className="text-center font-headline text-2xl uppercase tracking-tight text-primary">
            AU Global Assistant
          </DialogTitle>
          <div className="flex items-center justify-center gap-2 py-1 px-3 rounded-full bg-primary/10 w-fit mx-auto border border-primary/20">
            <Sparkles className="h-3 w-3 text-primary animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Under Development</span>
          </div>
          <DialogDescription className="text-center text-base pt-2 text-foreground/80 leading-relaxed">
            AU Global is currently being fine-tuned to provide a comprehensive study experience across <strong>all your documents at once</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="rounded-xl border border-primary/10 bg-primary/5 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="mt-1 bg-primary/20 rounded-md p-1">
                <Info className="h-4 w-4 text-primary" />
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-sm text-primary uppercase tracking-tight">What is AU Global?</h4>
                <p className="text-sm text-muted-foreground leading-snug">
                  Unlike regular chat which focuses on one document, AU Global connects your entire library. Cross-reference facts, find overarching themes, and synthesize knowledge from every file you've uploaded.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 p-4 rounded-xl border border-dashed border-muted-foreground/20 bg-muted/5">
            <div className="bg-muted-foreground/10 rounded-full p-2">
              <MessageCircle className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h4 className="font-bold text-sm text-foreground/80 uppercase tracking-tight">Suggestions?</h4>
              <p className="text-xs text-muted-foreground">
                We're building this for you. Tell us what cross-document features would help you study better!
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1 uppercase font-bold tracking-tighter">
            Close
          </Button>
          <Button 
            onClick={() => {
              onOpenChange(false);
              onContactSupport();
            }} 
            className="flex-1 font-bold uppercase tracking-tighter shadow-lg shadow-primary/20"
          >
            Contact Support
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
