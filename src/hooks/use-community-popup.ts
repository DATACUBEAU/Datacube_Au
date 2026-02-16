import { useState, useEffect, useCallback } from 'react';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { supabase } from '@/lib/supabase-client/client';

export function useCommunityPopup() {
  const [user, loading] = useSupabaseUser();
  const [isOpen, setIsOpen] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);

  useEffect(() => {
    if (loading || !user || hasChecked) return;

    const checkStatus = async () => {
      // 1. Check LocalStorage (Fastest)
      const localSeen = localStorage.getItem(`au_community_seen_${user.id}`);
      if (localSeen) {
        setHasChecked(true);
        return;
      }

      // 2. Check Supabase User Metadata (Source of Truth)
      const meta = user.user_metadata || {};
      if (meta.has_seen_community_prompt) {
        // Sync local
        localStorage.setItem(`au_community_seen_${user.id}`, 'true');
        setHasChecked(true);
        return;
      }

      // 3. If neither, show popup
      setIsOpen(true);
      setHasChecked(true);
    };

    checkStatus();
  }, [user, loading, hasChecked]);

  const markAsSeen = useCallback(async () => {
    if (!user) return;
    
    setIsOpen(false);
    
    // 1. Update Local
    localStorage.setItem(`au_community_seen_${user.id}`, 'true');

    // 2. Update Server (Background)
    try {
      await supabase.auth.updateUser({
        data: { has_seen_community_prompt: true }
      });
    } catch (e) {
      console.warn("Failed to sync community prompt status to server", e);
    }
  }, [user]);

  return {
    isOpen,
    markAsSeen
  };
}
