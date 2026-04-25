import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const PROVIDER_KEY_TABLES = ["au_api_keys", "ai_provider_keys"] as const;

function isMissingTableError(error: any, table: string): boolean {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "").toLowerCase();
  const details = String(error?.details || "").toLowerCase();
  const tableRef = `public.${table}`.toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes(`table '${tableRef}'`) ||
    details.includes(`table '${tableRef}'`) ||
    (message.includes("schema cache") && message.includes(table.toLowerCase())) ||
    (details.includes("schema cache") && details.includes(table.toLowerCase()))
  );
}

export async function getApiKey(supabase: any, service: string): Promise<string> {
  // Try to get from env first (standard way)
  const envKey = Deno.env.get(`${service.toUpperCase()}_API_KEY`);
  if (envKey) return envKey;

  let lastError: any = null;
  for (const table of PROVIDER_KEY_TABLES) {
    const { data, error } = await supabase
      .from(table)
      .select("key_value")
      .eq("service", service)
      .single();

    if (!error && data?.key_value) {
      return data.key_value;
    }

    if (error && !isMissingTableError(error, table)) {
      lastError = error;
      break;
    }
    lastError = error;
  }

  const msg =
    lastError?.message
      ? `API key lookup failed for ${service}: ${String(lastError.message)}`
      : `API key for ${service} not found. Ensure it exists in au_api_keys/ai_provider_keys or set ${service.toUpperCase()}_API_KEY.`;
  console.error(`[getApiKey] ${msg}`);
  throw new Error(msg);
}
