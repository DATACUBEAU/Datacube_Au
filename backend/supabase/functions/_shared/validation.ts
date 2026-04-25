import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

// --- MEMORY PACK SCHEMA ---

const AppContextSchema = z.object({
  current_page: z.enum([
    "knowledge_hud", "documents", "practice_exam", "predictions", 
    "past_questions", "au_chat", "global_chat", "billing", "settings"
  ]).optional(),
  last_pages: z.array(z.string()).max(5).optional(),
  session_flags: z.object({
    billing_enabled: z.boolean().optional(),
    promo_enabled: z.boolean().optional(),
    limits_alerts_enabled: z.boolean().optional(),
  }).optional(),
  timestamps: z.object({
    client_time_iso: z.string().datetime().optional()
  }).optional()
});

const ProfileSchema = z.object({
  tier: z.enum(["free", "weekly", "monthly"]).optional(),
  tier_expires_at_iso: z.string().nullable().optional(),
  study_level: z.string().nullable().optional(),
  exam_type: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  language: z.string().optional(),
  tone: z.enum(["short", "friendly", "strict"]).optional()
});

const PreferencesSchema = z.object({
  answer_style: z.enum(["bullets", "step_by_step", "concise"]).optional(),
  difficulty: z.enum(["easy", "normal", "hard"]).optional(),
  reminders: z.boolean().optional()
});

const GoalsSchema = z.object({
  primary_goal: z.string().nullable().optional(),
  target_exam_date_iso: z.string().nullable().optional()
});

const AuActivitySummarySchema = z.object({
  last_active_at_iso: z.string().nullable().optional(),
  last_doc_title: z.string().nullable().optional(),
  last_doc_id: z.string().nullable().optional(),
  last_feature: z.enum([
    "rag_chat", "summary", "practice_exam", "prediction", "cbt", "upload", "none"
  ]).optional(),
  weekly_usage: z.object({
    docs_indexed: z.number().optional(),
    rag_chats: z.number().optional(),
    summaries: z.number().optional(),
    predictions: z.number().optional(),
    cbt_runs: z.number().optional(),
    practice_exam_runs: z.number().optional()
  }).optional()
});

export const MemoryPackSchema = z.object({
  profile: ProfileSchema.optional(),
  preferences: PreferencesSchema.optional(),
  goals: GoalsSchema.optional(),
  global_digest: z.string().max(700).optional(),
  au_activity_summary: AuActivitySummarySchema.optional()
});

export const RecentSnippetSchema = z.object({
  mode: z.enum(["turns", "summary"]),
  turns: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(300) // Flexible max, stricter in logic
  })).max(10).optional(),
  summary: z.string().max(600).optional()
});

const DocumentContextSchema = z.object({
  active_document_id: z.string().nullable().optional(),
  active_document_name: z.string().nullable().optional(),
  last_uploaded_document_id: z.string().nullable().optional(),
  last_retrieved_document_id: z.string().nullable().optional(),
  last_retrieved_source_ids: z.array(z.string()).max(12).optional(),
  document_count_in_scope: z.number().int().min(0).optional(),
  last_resolved_reference_at: z.string().nullable().optional(),
}).partial();

// --- ENDPOINT SCHEMAS ---

export const GlobalChatSchema = z.object({
  chat_type: z.literal("global"),
  thread_id: z.string().optional(),
  user_input: z.string().min(1),
  app_context: AppContextSchema.optional(),
  memory_pack: MemoryPackSchema.optional(),
  recent_snippet: RecentSnippetSchema.optional(),
  // Legacy fields for backward compatibility (optional)
  messages: z.array(z.any()).optional(), 
});

export const AuChatSchema = z.object({
  chat_type: z.literal("au_rag"),
  thread_id: z.string().optional(),
  doc_id: z.string(), // Mandatory
  user_input: z.string().min(1),
  retrieval: z.object({
    top_k: z.number().max(10).optional(),
    min_score: z.number().min(0).max(1).optional()
  }).optional(),
  recent_snippet: RecentSnippetSchema.optional(),
  document_context: DocumentContextSchema.optional(),
  au_handoff_hint: z.object({
    allow_suggest_global_chat: z.boolean().optional()
  }).optional(),
  // Legacy fields
  messages: z.array(z.any()).optional(),
  selectedDocId: z.string().optional(),
  action: z.string().optional()
});

export const MemoryCompactionSchema = z.object({
  chat_type: z.literal("global"),
  uid: z.string(),
  current_digest: z.string().max(700).optional(),
  recent_turns: z.array(z.object({
    role: z.string(),
    content: z.string()
  })).max(15)
});

export const IdSchema = z.string().uuid();
export const PlanSchema = z.enum(["weekly", "monthly"]);

export { z };
