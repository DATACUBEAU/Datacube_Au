'use client';

import { useState } from 'react';
import { ThumbsUp, ThumbsDown, MessageSquare, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';

interface FeedbackSectionProps {
  sectionName: string;
}

export function FeedbackSection({ sectionName }: FeedbackSectionProps) {
  const [user] = useSupabaseUser();
  const [feedbackType, setFeedbackType] = useState<'positive' | 'negative' | null>(null);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [isOther, setIsOther] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reasons = feedbackType === 'positive' 
    ? ['Accurate analysis', 'Clear explanation', 'Helpful context', 'Great depth']
    : ['Inaccurate details', 'Too brief', 'Confusing explanation', 'Missing key info'];

  const handleSubmit = async (selectedReason?: string) => {
    const finalReason = selectedReason || reason;
    setIsSubmitting(true);

    try {
      const guestToken = typeof window !== 'undefined' ? localStorage.getItem('guest_token') : null;
      let guestSessionId = null;

      if (guestToken) {
        try {
          const { decodeJWT } = await import('@/lib/supabase/client');
          const decoded = decodeJWT(guestToken);
          guestSessionId = decoded?.guest_session_id || decoded?.sub;
        } catch (e) {
          console.error("Failed to decode guest token", e);
        }
      }

      const { error } = await supabase.from('au_feedback').insert([{
        user_id: user?.id || null,
        guest_session_id: guestSessionId,
        section: sectionName,
        rating: feedbackType,
        comment: finalReason,
        metadata: {
          url: window.location.href,
          timestamp: new Date().toISOString()
        }
      }]);

      if (error) throw error;

      toast({
        title: "Feedback received",
        description: "Thank you for helping us improve AU!",
      });
    } catch (err: any) {
      console.error("Failed to submit feedback:", err);
      toast({
        variant: "destructive",
        title: "Submission failed",
        description: "We couldn't save your feedback. Please try again later.",
      });
    } finally {
      setIsSubmitting(false);
      setIsPopoverOpen(false);
      setFeedbackType(null);
      setReason('');
      setIsOther(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-6 flex flex-col items-center gap-3 border-t pt-4"
    >
      <p className="text-sm font-medium text-muted-foreground italic">
        Is this AU ANALYSIS helpful so far?
      </p>
      
      <div className="flex items-center gap-4">
        <Popover open={isPopoverOpen && feedbackType === 'positive'} onOpenChange={(open) => {
          setIsPopoverOpen(open);
          if (!open) setFeedbackType(null);
        }}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 rounded-full hover:bg-green-100 hover:text-green-600 transition-colors"
              onClick={() => {
                setFeedbackType('positive');
                setIsPopoverOpen(true);
              }}
            >
              <ThumbsUp className="h-5 w-5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" side="top">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Why was it helpful?</p>
              {!isOther ? (
                <div className="grid grid-cols-1 gap-1">
                  {reasons.map((r) => (
                    <Button 
                      key={r} 
                      variant="ghost" 
                      size="sm" 
                      className="justify-start text-xs h-8"
                      onClick={() => handleSubmit(r)}
                    >
                      {r}
                    </Button>
                  ))}
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="justify-start text-xs h-8 text-primary"
                    onClick={() => setIsOther(true)}
                  >
                    Other...
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Textarea 
                    placeholder="Tell us more..." 
                    className="text-xs min-h-[60px]"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => setIsOther(false)} disabled={isSubmitting}>Back</Button>
                    <Button size="sm" className="h-7 text-[10px]" onClick={() => handleSubmit()} disabled={isSubmitting}>
                      {isSubmitting ? "..." : "Submit"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>

        <Popover open={isPopoverOpen && feedbackType === 'negative'} onOpenChange={(open) => {
          setIsPopoverOpen(open);
          if (!open) setFeedbackType(null);
        }}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 rounded-full hover:bg-red-100 hover:text-red-600 transition-colors"
              onClick={() => {
                setFeedbackType('negative');
                setIsPopoverOpen(true);
              }}
            >
              <ThumbsDown className="h-5 w-5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" side="top">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground">How can we improve?</p>
              {!isOther ? (
                <div className="grid grid-cols-1 gap-1">
                  {reasons.map((r) => (
                    <Button 
                      key={r} 
                      variant="ghost" 
                      size="sm" 
                      className="justify-start text-xs h-8"
                      onClick={() => handleSubmit(r)}
                    >
                      {r}
                    </Button>
                  ))}
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="justify-start text-xs h-8 text-primary"
                    onClick={() => setIsOther(true)}
                  >
                    Other...
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Textarea 
                    placeholder="Tell us more..." 
                    className="text-xs min-h-[60px]"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => setIsOther(false)} disabled={isSubmitting}>Back</Button>
                    <Button size="sm" className="h-7 text-[10px]" onClick={() => handleSubmit()} disabled={isSubmitting}>
                      {isSubmitting ? "..." : "Submit"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </motion.div>
  );
}
