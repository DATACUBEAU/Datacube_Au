import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export interface ModelConfig {
  model_id: string;
  display_name: string;
  provider: string;
  type: 'chat' | 'embedding';
  is_free: boolean;
  context_window: number;
  rate_limit_rpm: number;
}

export class ConfigService {
  private static instance: ConfigService;
  private supabase: SupabaseClient;
  private cache: Map<string, any> = new Map();
  private cacheTTL = 60000; // 1 minute cache for models

  private constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  public static getInstance(supabase: SupabaseClient): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService(supabase);
    }
    return ConfigService.instance;
  }

  private async getWithCache<T>(cacheKey: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
      return cached.data;
    }

    const data = await fetcher();
    this.cache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  }

  public async getEmbeddingModelId(): Promise<string> {
    return this.getWithCache('embedding_model_id', async () => {
      const { data, error } = await this.supabase
        .from('au_rag_settings')
        .select('value')
        .eq('key', 'embedding_model')
        .single();
      
      if (error || !data) return 'openai/text-embedding-ada-002';
      return typeof data.value === 'string' ? data.value : data.value.model_id;
    });
  }

  public async getDefaultChatModelId(): Promise<string> {
    return this.getWithCache('default_chat_model_id', async () => {
      const { data, error } = await this.supabase
        .from('au_rag_settings')
        .select('value')
        .eq('key', 'default_chat_model')
        .single();
      
      if (!error && data) {
        const explicit = typeof data.value === 'string' ? data.value : data.value?.model_id;
        if (typeof explicit === 'string' && explicit.trim().length > 0) return explicit.trim();
      }

      const { data: proRows } = await this.supabase
        .from('au_pro_models_registry')
        .select('model_id')
        .eq('is_active', true)
        .order('model_id', { ascending: true })
        .limit(1);

      const proModel = typeof proRows?.[0]?.model_id === 'string' ? String(proRows?.[0]?.model_id).trim() : '';
      if (proModel.length > 0) return proModel;

      const { data: freeRows } = await this.supabase
        .from('au_models_registry')
        .select('model_id')
        .eq('is_active', true)
        .eq('type', 'chat')
        .order('model_id', { ascending: true })
        .limit(1);

      const freeModel = typeof freeRows?.[0]?.model_id === 'string' ? String(freeRows?.[0]?.model_id).trim() : '';
      if (freeModel.length > 0) return freeModel;

      throw new Error('No active chat models configured in registry.');
    });
  }

  public async getActiveChatModels(): Promise<ModelConfig[]> {
    return this.getWithCache('active_chat_models', async () => {
      const { data, error } = await this.supabase
        .from('au_models_registry')
        .select('*')
        .eq('type', 'chat')
        .eq('is_active', true);
      
      if (error) throw new Error(`Failed to fetch models: ${error.message}`);
      return data || [];
    });
  }

  public async getRotatedKey(provider: string = 'openrouter'): Promise<string> {
    const { data, error } = await this.supabase.rpc('get_rotated_api_key', { p_provider: provider });
    if (error || !data) {
      throw new Error(`No active API keys found for provider: ${provider}`);
    }
    return data;
  }

  public async reportKeyFailure(keyValue: string): Promise<void> {
    const { error } = await this.supabase.rpc('report_api_key_failure', { p_key_value: keyValue });
    if (error) {
      console.warn(`[ConfigService] report_api_key_failure failed: ${error.message}`);
    }
  }
}
