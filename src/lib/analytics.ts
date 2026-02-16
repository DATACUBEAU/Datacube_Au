import { supabase, invokeEdgeFunction } from '@/lib/supabase-client/client';

export const logEvent = async (name: string, params: Record<string, any> = {}, tier?: string) => {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) return;

    invokeEdgeFunction('log-event', {
      method: 'POST',
      requireAuth: true,
      silent: true,
      body: {
        name,
        params,
        tier,
      },
    }).catch(() => {});
  } catch (e) {
  }
};
