import { useState, useEffect, useCallback, useRef } from 'react';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { supabase } from '@/lib/supabase-client/client';

export function useCommunityPopup() {
  const [user, , loading] = useSupabaseUser();
  const [isOpen, setIsOpen] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  const checkedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (loading) return;

    if (!user) {
      setIsOpen(false);
      setIsJoined(false);
      checkedUserIdRef.current = null;
      return;
    }

    if (checkedUserIdRef.current === user.id) return;
    checkedUserIdRef.current = user.id;
    setIsOpen(false);
    setIsJoined(false);

    // Check joined status
    const localJoined = localStorage.getItem(`au_community_joined_${user.id}`);
    const meta = user.user_metadata || {};
    
    if (localJoined || meta.has_joined_community) {
      setIsJoined(true);
      if (!localJoined) {
        localStorage.setItem(`au_community_joined_${user.id}`, 'true');
      }
    }

    const checkStatus = async () => {
      // 1. Check LocalStorage (Fastest)
      const localSeen = localStorage.getItem(`au_community_seen_${user.id}`);
      if (localSeen) {
        return;
      }

      // 2. Check Supabase User Metadata (Source of Truth)
      if (meta.has_seen_community_prompt) {
        // Sync local
        localStorage.setItem(`au_community_seen_${user.id}`, 'true');
        return;
      }

      // 3. If neither, show popup
      setIsOpen(true);
    };

    checkStatus();
  }, [user, loading]);

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

  const markAsJoined = useCallback(async () => {
    if (!user) return;

    setIsJoined(true);
    setIsOpen(false);

    // 1. Update Local
    localStorage.setItem(`au_community_seen_${user.id}`, 'true');
    localStorage.setItem(`au_community_joined_${user.id}`, 'true');

    // 2. Update Server (Background)
    try {
      await supabase.auth.updateUser({
        data: { 
          has_seen_community_prompt: true,
          has_joined_community: true 
        }
      });
    } catch (e) {
      console.warn("Failed to sync community joined status to server", e);
    }
  }, [user]);

  return {
    isOpen,
    isJoined,
    markAsSeen,
    markAsJoined
  };
}
