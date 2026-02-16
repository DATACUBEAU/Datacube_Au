
'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2, Info } from "lucide-react";
import { LocalChatStorage } from "@/lib/storage/local-chat";
import { useToast } from "@/hooks/use-toast";

interface GlobalHistoryPromptProps {
  userId: string;
  onClearComplete?: () => void;
}

export function GlobalHistoryPrompt({ userId, onClearComplete }: GlobalHistoryPromptProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();

  const handleClearAll = async () => {
    if (!userId) return;
    // 1. Clear device history
    const { removedCount, removedKeys } = LocalChatStorage.clearAllGlobalChats(userId);
    
    // DEV ONLY LOG
    if (process.env.NODE_ENV === 'development') {
      console.log(`[GlobalHistory] Full Reset Step 1: Removed ${removedCount} keys`, removedKeys);
    }

    // 2. Reset memory (Server summary + local working memory)
    try {
        const { clearWorkingMemory, globalMemoryKey } = await import('@/lib/memory/working-memory');
        const { deleteMemorySummary } = await import('@/lib/api/memory-summaries');
        await clearWorkingMemory(globalMemoryKey(userId));
        await deleteMemorySummary({ scope: 'global' });
        if (process.env.NODE_ENV === 'development') {
          console.log(`[GlobalHistory] Full Reset Step 2: Hybrid Memory Reset SUCCESS`);
        }
        
        toast({ title: "Full Reset Complete", description: "Device history and cloud memory have been cleared." });
    } catch (error) {
        console.error(`[GlobalHistory] Full Reset Step 2: Hybrid Memory Reset FAILED`, error);
        toast({ variant: "destructive", title: "Cloud Reset Failed", description: "Could not reset cloud memory. Check connection." });
    }
    
    setIsDialogOpen(false);
    onClearComplete?.();
  };

  return (
    <>
      {/* 1. NON-BLOCKING BANNER (Always Visible) */}
      <div className="w-full bg-muted/30 border-b border-primary/10 px-4 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 text-primary/70" />
          <span>Global Chat history is stored on this device.</span>
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={() => setIsDialogOpen(true)}
        >
          Clear History
        </Button>
      </div>

      {/* 2. CONFIRMATION DIALOG (On Click Only) */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-muted-foreground" />
              Manage Global History
            </DialogTitle>
            <DialogDescription>
              Choose how you want to handle your Global Chat history.
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex flex-col gap-3 py-4">
            <Button 
              variant="destructive" 
              className="justify-start h-auto py-3 px-4 bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20 border w-full"
              onClick={handleClearAll}
            >
              <Trash2 className="mr-3 h-5 w-5" />
              <div className="flex flex-col items-start text-left">
                <span className="font-semibold">Clear Chat History</span>
                <span className="text-xs opacity-80">Permanently removes history from this device and the cloud.</span>
              </div>
            </Button>
          </div>

          <DialogFooter className="sm:justify-between flex-row items-center gap-2">
            <span className="text-[10px] text-muted-foreground hidden sm:inline-block">
              Actions are irreversible.
            </span>
            <Button variant="ghost" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
