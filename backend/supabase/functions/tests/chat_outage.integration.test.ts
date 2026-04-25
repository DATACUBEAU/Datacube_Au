/// <reference path="../deno.d.ts" />
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@0.224.0";
import { callAU } from "../_shared/au.ts";

type Filters = Record<string, unknown>;

function createMockSupabase() {
  return {
    from(table: string) {
      const filters: Filters = {};
      const builder: any = {
        select() {
          return builder;
        },
        eq(col: string, value: unknown) {
          filters[col] = value;
          return builder;
        },
        gt(col: string, value: unknown) {
          filters[col] = value;
          return builder;
        },
        in(col: string, value: unknown) {
          filters[col] = value;
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        maybeSingle: async () => {
          const data = resolveRows(table, filters)[0] ?? null;
          return { data, error: null };
        },
        single: async () => {
          const data = resolveRows(table, filters)[0] ?? null;
          if (!data) return { data: null, error: { code: "PGRST116", message: "Not found" } };
          return { data, error: null };
        },
        insert: async () => ({ data: null, error: null }),
        upsert: async () => ({ data: null, error: null }),
        update: () => builder,
        then: (resolve: (value: any) => void) => {
          resolve({ data: resolveRows(table, filters), error: null });
        },
      };
      return builder;
    },
    rpc: async () => ({ data: null, error: null }),
  } as any;
}

function resolveRows(table: string, filters: Filters): any[] {
  if (table === "au_user_profiles") {
    if (filters.user_id === "user-1") {
      return [{ user_id: "user-1", tier: "free", stripe_status: null, tier_expires_at: null, billing_source: null }];
    }
    return [];
  }
  if (table === "au_conex_config") {
    return [{ id: 1, billing_enabled: false, premium_models_enabled: true, premium_models_paid_only: true, paid_mode_enabled: false }];
  }
  if (table === "au_config") {
    return [{ id: 1, billing_enabled: false }];
  }
  if (table === "au_api_keys") {
    return [{
      service: "openrouter_1",
      key_value: "sk-test-openrouter",
      provider_type: "openrouter",
      is_active: true,
      metadata: { tier: "free" },
      allowed_models: null,
      last_used_at: null,
    }];
  }
  if (table === "au_models_registry") {
    return [{
      model_id: "google/gemini-2.0-flash-exp:free",
      is_active: true,
      is_free: true,
      type: "chat",
    }];
  }
  return [];
}

Deno.test("callAU degrades gracefully when all models are unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const originalFallbackFlag = Deno.env.get("AI_FALLBACK_ENABLED");
  Deno.env.set("AI_FALLBACK_ENABLED", "false");

  (globalThis as any).fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/models/user")) {
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({ error: { message: "No endpoints found for model" } }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const mockSupabase = createMockSupabase();
    const err = await assertRejects(
      async () => {
        await callAU(
          mockSupabase,
          "You are a test system.",
          "Test prompt",
          0.5,
          false,
          undefined,
          { userId: "user-1", feature: "integration-test", sessionId: "req-test", ownershipFilter: { user_id: "user-1" } },
          "chat",
        );
      },
      Error,
    );

    assertEquals((err as any).status, 503);
    const message = String((err as any).message || "");
    assert(message.includes("All AI models are currently unavailable"));
  } finally {
    (globalThis as any).fetch = originalFetch;
    if (originalFallbackFlag == null) {
      Deno.env.delete("AI_FALLBACK_ENABLED");
    } else {
      Deno.env.set("AI_FALLBACK_ENABLED", originalFallbackFlag);
    }
  }
});
