
/// <reference path="../deno.d.ts" />
import { assertEquals, assertRejects } from "jsr:@std/assert@0.224.0";
import { getAURequestConfig } from "../_shared/model_registry.ts";

// Mock Supabase Client
const createMockSupabase = (
  apiKeys: any[] = [],
  models: any[] = [],
  billingEnabled: boolean = false,
  proModels: any[] = []
) => {
  return {
    from: (table: string) => {
      const builder: any = {
        select: (cols: string) => builder,
        eq: (col: string, val: any) => {
            // Store filters if needed, or just return builder
            return builder;
        },
        order: (col: string, opts: any) => builder,
        single: async () => {
          if (table === 'au_conex_config') {
            return { data: { billing_enabled: billingEnabled }, error: null };
          }
          return { data: null, error: null };
        },
        insert: async (data: any) => {
           console.log(`[Mock] Insert into ${table}:`, data);
           if (table === 'au_models_registry') {
               models.push(data);
           }
           return { error: null };
        },
        update: (data: any) => builder,
        then: (resolve: any) => {
            // Resolve promise based on table
            if (table === 'au_api_keys') {
                resolve({ data: apiKeys, error: null });
            } else if (table === 'au_models_registry') {
                resolve({ data: models, error: null });
            } else if (table === 'au_pro_models_registry') {
                resolve({ data: proModels, error: null });
            } else {
                resolve({ data: [], error: null });
            }
        }
      };
      return builder;
    },
    rpc: async (fn: string, args: any) => {
        return { data: null, error: null };
    }
  } as any;
};

Deno.test("getAURequestConfig - Free Tier Success", async () => {
  const mockKeys = [{ service: 'openrouter_1', key_value: 'sk-test-123', provider_type: 'openrouter', allowed_models: null }];
  const mockModels = [{ model_id: 'google/gemini-2.0-flash-exp:free' }];
  
  const client = createMockSupabase(mockKeys, mockModels, false);
  
  const config = await getAURequestConfig(client, [], 'chat', 'free');
  
  assertEquals(config.modelId, 'google/gemini-2.0-flash-exp:free');
  assertEquals(config.apiKey, 'sk-test-123');
});

Deno.test("getAURequestConfig - Free Tier Fallback Insertion", async () => {
  const mockKeys = [{ service: 'openrouter_1', key_value: 'sk-test-123', provider_type: 'openrouter', allowed_models: null }];
  const mockModels: any[] = []; // Empty models
  
  const client = createMockSupabase(mockKeys, mockModels, false);
  
  const config = await getAURequestConfig(client, [], 'chat', 'free');
  
  // Should have inserted default model and used it
  assertEquals(config.modelId, 'google/gemini-2.0-flash-exp:free');
  assertEquals(config.apiKey, 'sk-test-123');
});

Deno.test("getAURequestConfig - Free Tier Key Selection (Metadata Fallback)", async () => {
  // No openrouter_1, but a key with metadata.tier = 'free'
  const mockKeys = [{ service: 'custom_free_key', key_value: 'sk-free-custom', provider_type: 'openrouter', metadata: { tier: 'free' }, allowed_models: null }];
  const mockModels = [{ model_id: 'google/gemini-2.0-flash-exp:free' }];
  
  const client = createMockSupabase(mockKeys, mockModels, false);
  
  const config = await getAURequestConfig(client, [], 'chat', 'free');
  
  assertEquals(config.modelId, 'google/gemini-2.0-flash-exp:free');
  assertEquals(config.apiKey, 'sk-free-custom');
});

Deno.test("getAURequestConfig - Free Tier No Keys Error", async () => {
  const mockKeys: any[] = []; // No keys
  const mockModels = [{ model_id: 'google/gemini-2.0-flash-exp:free' }];
  
  const client = createMockSupabase(mockKeys, mockModels, false);
  
  await assertRejects(
    async () => {
      await getAURequestConfig(client, [], 'chat', 'free');
    },
    Error,
    "No active API keys found."
  );
});

Deno.test("getAURequestConfig - Free Tier No Matching Model for Key", async () => {
  // Key only allows 'other-model', but registry only has 'google/gemini-2.0-flash-exp:free'
  const mockKeys = [{ service: 'openrouter_1', key_value: 'sk-test-123', provider_type: 'openrouter', allowed_models: ['other-model'] }];
  const mockModels = [{ model_id: 'google/gemini-2.0-flash-exp:free' }];
  
  const client = createMockSupabase(mockKeys, mockModels, false);
  
  await assertRejects(
    async () => {
      await getAURequestConfig(client, [], 'chat', 'free');
    },
    Error,
    "No available model config for tier free"
  );
});
