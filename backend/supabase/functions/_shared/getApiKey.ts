import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export async function getApiKey(supabase: any, service: string): Promise<string> {
  // Try to get from env first (standard way)
  const envKey = Deno.env.get(`${service.toUpperCase()}_API_KEY`);
  if (envKey) return envKey;

  // Fallback to database (as requested by user)
  const { data, error } = await supabase
    .from('au_api_keys')
    .select('key_value')
    .eq('service', service)
    .single();

  if (error || !data) {
    const msg = `API key for ${service} not found. Please ensure it is set in 'au_api_keys' table or as ${service.toUpperCase()}_API_KEY environment variable.`;
    console.error(`[getApiKey] ${msg}`);
    throw new Error(msg);
  }

  // In a real scenario, decrypt here if stored encrypted using pgcrypto and a key
  // For now, assuming RLS protection is the main security layer as requested
  return data.key_value;
}
