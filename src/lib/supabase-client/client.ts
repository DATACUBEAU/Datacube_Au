import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

const publicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SUPABASE_BUCKET: process.env.NEXT_PUBLIC_SUPABASE_BUCKET,
} as const;

type PublicEnvKey = keyof typeof publicEnv;

function requiredEnv(key: PublicEnvKey): string {
  const value = publicEnv[key];
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'unknown';
  const k = "dcau_device_id";
  let v = localStorage.getItem(k);
  if (!v) {
    v = crypto.randomUUID();
    localStorage.setItem(k, v);
  }
  return v;
}

const customFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  
  const supabaseUrl = publicEnv.NEXT_PUBLIC_SUPABASE_URL || '';
  const isSupabaseRequest = supabaseUrl && url.includes(supabaseUrl);
  
  if (!isSupabaseRequest) {
    return fetch(input, init);
  }

  // Clone init to avoid mutating the original
  const newInit = { ...init };
  const headers = new Headers(newInit.headers);
  
  // Inject x-device-id
  const deviceId = getDeviceId();
  headers.set('x-device-id', deviceId);

  // If input is a Request, we need to be careful. 
  // Standard fetch behavior: if init.headers is present, it REPLACES input.headers.
  if (input instanceof Request) {
    try {
      input.headers.forEach((value, key) => {
        if (!headers.has(key)) {
          headers.set(key, value);
        }
      });
    } catch (e) {
      console.warn('[customFetch] Error merging request headers:', e);
    }
  }

  const anonKey = publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!headers.has('apikey') && anonKey) {
    headers.set('apikey', anonKey);
  }

  // Ensure Authorization header doesn't have double "Bearer" or "Bearer undefined"
  const finalAuth = headers.get('Authorization');
  if (finalAuth) {
    if (finalAuth.startsWith('Bearer Bearer ')) {
      headers.set('Authorization', finalAuth.replace('Bearer Bearer ', 'Bearer '));
    } else if (finalAuth === 'Bearer undefined' || finalAuth === 'Bearer null' || finalAuth === 'Bearer ') {
      headers.delete('Authorization');
    }
  }

  // CRITICAL: For multipart/form-data (FormData body), we MUST NOT set Content-Type header manually.
  // The browser needs to set it with the correct boundary string.
  const contentType = headers.get('content-type');
  const isMultipart = contentType?.includes('multipart/form-data');
  const isFormData = newInit.body instanceof FormData || isMultipart;
  
  if (isFormData) {
    headers.delete('Content-Type');
  }

  newInit.headers = headers;

  // Use the original Request object if available to preserve body and other settings
  const fetchInput = input;

  try {
    const response = await fetch(fetchInput, newInit);
    return response;
  } catch (err: any) {
    console.error(`[customFetch] Network error fetching ${url}:`, {
      name: err?.name,
      message: err?.message,
      url: url
    });
    throw err;
  }
};

export function createBrowserSupabaseClient(): SupabaseClient {
  const url = requiredEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

  return createClient(url, anonKey, {
    global: {
      fetch: customFetch,
    },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

export const supabase = createBrowserSupabaseClient();

async function getAccessToken(opts?: { refresh?: boolean }): Promise<string | null> {
  if (opts?.refresh) {
    try {
      await supabase.auth.refreshSession();
    } catch {
    }
  }

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function invokeEdgeFunction<T = any>(
  functionName: string,
  options?: { body?: any; headers?: Record<string, string>; requireAuth?: boolean }
): Promise<{ data: T | null; error: any | null }> {
  const token = await getAccessToken();
  if (options?.requireAuth && !token) {
    return { data: null, error: { message: 'No active session', status: 401 } };
  }
  const headers = {
    ...(options?.headers ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  let result = await supabase.functions.invoke(functionName, {
    body: options?.body,
    headers: Object.keys(headers).length ? headers : undefined,
  });

  const status = (result.error as any)?.context?.status ?? (result.error as any)?.status;
  if (result.error && status === 401) {
    const refreshed = await getAccessToken({ refresh: true });
    if (options?.requireAuth && !refreshed) {
      return { data: null, error: { message: 'No active session', status: 401 } };
    }
    const headers2 = {
      ...(options?.headers ?? {}),
      ...(refreshed ? { Authorization: `Bearer ${refreshed}` } : {}),
    };

    result = await supabase.functions.invoke(functionName, {
      body: options?.body,
      headers: Object.keys(headers2).length ? headers2 : undefined,
    });
  }

  return { data: (result as any).data ?? null, error: (result as any).error ?? null };
}

/**
 * Returns a filter string for manual ownership filtering in Supabase queries.
 * Handles authenticated users only.
 */
export async function getEffectiveOwnershipConditions(user: User | null): Promise<string> {
  // Prioritize authenticated user ID. 
  if (user?.id) {
    return `user_id.eq.${user.id}`;
  }

  // Fallback if no user is present
  // We return a filter that matches nothing
  return 'id.eq.00000000-0000-0000-0000-000000000000'; 
}

/**
 * Helper to apply ownership filters consistently to a PostgREST query.
 * Correctly handles single vs multiple conditions to avoid PostgREST 400 errors.
 */
export function applyOwnershipFilter(query: any, conditions: string) {
  if (!conditions) return query;
  
  const trimmed = conditions.trim();
  if (trimmed.includes(',')) {
    return query.or(trimmed);
  }
  
  // Handle single condition like "user_id.eq.xxx"
  // We use .eq() instead of .or() for better compatibility and performance
  const [col, val] = trimmed.split('.eq.');
  if (col && val) {
    return query.eq(col, val);
  }
  
  // Fallback to .or() if it doesn't match the .eq. pattern
  return query.or(trimmed);
}

/**
 * Updates the last_active_at timestamp and device info for the current user or guest.
 */
export async function updateUserActivity(
  user: User | null,
  opts?: { isOnline?: boolean }
): Promise<void> {
  try {
    const isStandalone = typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches;
    const isInstalled = typeof window !== 'undefined' && (window.navigator as any).standalone || isStandalone;
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
    const isOnline = typeof opts?.isOnline === 'boolean' ? opts.isOnline : (typeof navigator !== 'undefined' ? navigator.onLine : true);

    const { getDeviceInfo } = await import('@/lib/device/device-info');
    let deviceInfo: any = null;
    try {
      deviceInfo = await getDeviceInfo();
    } catch {
      deviceInfo = null;
    }
    
    // Detailed Device Context
    const metadata = {
      pwa: {
        isStandalone,
        isInstalled,
        displayMode: isStandalone ? 'standalone' : 'browser'
      },
      device: {
        browser: userAgent,
        browserName: deviceInfo?.browserName || 'unknown',
        browserVersion: deviceInfo?.browserVersion || '',
        platform: deviceInfo?.platform || (typeof navigator !== 'undefined' ? navigator.platform : 'unknown'),
        osName: deviceInfo?.osName || 'unknown',
        osVersion: deviceInfo?.osVersion || '',
        deviceModel: deviceInfo?.deviceModel || 'unknown',
        deviceType: deviceInfo?.deviceType || 'unknown',
        language: typeof navigator !== 'undefined' ? navigator.language : 'unknown',
        timeZone: deviceInfo?.timeZone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'unknown'),
        isMobile: deviceInfo?.deviceType ? (deviceInfo.deviceType === 'mobile' || deviceInfo.deviceType === 'tablet') : /iPhone|iPad|iPod|Android/i.test(userAgent),
        screen: deviceInfo?.screenResolution || (typeof window !== 'undefined' ? `${window.screen.width}x${window.screen.height}` : 'unknown')
      },
      connection: {
        isOnline,
        checked_at: new Date().toISOString(),
        navigator_onLine: typeof navigator !== 'undefined' ? navigator.onLine : true
      },
      updated_at: new Date().toISOString()
    };

    if (user?.id) {
      try {
        await supabase.from('users').upsert({ id: user.id }, { onConflict: 'id' });
      } catch {
      }

      const { error } = await supabase
        .from('au_user_activity')
        .upsert({ 
          user_id: user.id, 
          last_active_at: new Date().toISOString(),
          user_agent: userAgent,
          is_pwa: isStandalone,
          metadata: metadata
        }, { onConflict: 'user_id' });
        
      if (error) {
        if (error.code === '23503') {
          try {
            await supabase.from('users').upsert({ id: user.id }, { onConflict: 'id' });
          } catch {
          }

          const retry = await supabase
            .from('au_user_activity')
            .upsert(
              {
                user_id: user.id,
                last_active_at: new Date().toISOString(),
                user_agent: userAgent,
                is_pwa: isStandalone,
                metadata: metadata,
              },
              { onConflict: 'user_id' }
            );

          if (!retry.error) return;
          return;
        }

        if (error.code === '23505' || error.code === '409') {
          await supabase
            .from('au_user_activity')
            .update({
              last_active_at: new Date().toISOString(),
              user_agent: userAgent,
              is_pwa: isStandalone,
              metadata: metadata,
            })
            .eq('user_id', user.id);
        } else if (error.code !== '406') {
          console.warn('[client] Activity update error:', error);
        }
      }
    }
  } catch (e) {
    console.warn('[client] Failed to update activity:', e);
  }
}
