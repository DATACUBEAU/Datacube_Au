import { db } from './client';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, increment } from 'firebase/firestore';
import type { MemoryPack } from '@/lib/api/chat';

export const MemoryLedger = {
  /**
   * Fetch all memory components for the "Memory Pack"
   * Returns a structured object matching the backend schema
   */
  getMemoryPack: async (userId: string): Promise<MemoryPack | undefined> => {
    if (!userId) return undefined;

    try {
      const profileRef = doc(db, `users/${userId}/memory/profile`);
      const prefsRef = doc(db, `users/${userId}/memory/preferences`);
      const goalsRef = doc(db, `users/${userId}/memory/goals`);
      const digestRef = doc(db, `users/${userId}/memory/global_digest`);
      const activityRef = doc(db, `users/${userId}/memory/au_activity`);

      const [profileSnap, prefsSnap, goalsSnap, digestSnap, activitySnap] = await Promise.all([
        getDoc(profileRef),
        getDoc(prefsRef),
        getDoc(goalsRef),
        getDoc(digestRef),
        getDoc(activityRef)
      ]);

      return {
        profile: profileSnap.exists() ? profileSnap.data() as any : {},
        preferences: prefsSnap.exists() ? prefsSnap.data() as any : {},
        goals: goalsSnap.exists() ? goalsSnap.data() as any : {},
        global_digest: digestSnap.exists() ? (digestSnap.data()?.summary || "") : "",
        au_activity_summary: activitySnap.exists() ? activitySnap.data() as any : {}
      };
    } catch (e) {
      console.warn('[MemoryLedger] Failed to fetch memory pack:', e);
      return undefined;
    }
  },

  /**
   * Update AU Activity (called by AU Chat client)
   */
  updateAuActivity: async (userId: string, docId: string, docTitle: string, featureType: string = 'rag_chat') => {
    if (!userId) return;
    const ref = doc(db, `users/${userId}/memory/au_activity`);
    
    try {
      await setDoc(ref, {
        last_doc_id: docId,
        last_doc_title: docTitle,
        last_feature: featureType,
        last_active_at_iso: new Date().toISOString(),
        // Increment usage counters
        weekly_usage: {
            [featureType === 'rag_chat' ? 'rag_chats' : featureType + 's']: increment(1)
        }
      }, { merge: true });
    } catch (e) {
      console.error('[MemoryLedger] Failed to update AU activity:', e);
    }
  },

  /**
   * Reset Global Chat Memory (Clear History Action)
   */
  resetGlobalMemory: async (userId: string) => {
      if (!userId) return;
      try {
          const batch = (await import('firebase/firestore')).writeBatch(db);
          batch.set(doc(db, `users/${userId}/memory/global_digest`), { summary: "" });
          batch.set(doc(db, `users/${userId}/memory/preferences`), {}); // Reset to empty/defaults
          batch.set(doc(db, `users/${userId}/memory/goals`), {}); // Reset to empty
          await batch.commit();
      } catch (e) {
          console.error('[MemoryLedger] Failed to reset global memory:', e);
      }
  },

  /**
   * Create/Update AU Thread Meta (for Expiry)
   */
  touchAuThread: async (userId: string, threadId: string) => {
    if (!userId) return;
    const ref = doc(db, `users/${userId}/au_threads/${threadId}`);
    try {
        await setDoc(ref, {
            updatedAt: serverTimestamp(),
            expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // 3 days from now
        }, { merge: true });
    } catch (e) {
        // Ignore errors
    }
  }
};
