'use client';

import { useEffect, useState } from 'react';

export function useFirebaseListener<T = any>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }

    setLoading(false);
    setData(null);
    setError(new Error('Firebase listener has been removed. Use Supabase tables/realtime instead.'));
  }, [path]);

  return { data, loading, error };
}
