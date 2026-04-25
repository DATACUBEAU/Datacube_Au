BEGIN;

UPDATE public.au_usage_metric_definitions
SET
  limit_key = NULL,
  updated_at = now()
WHERE metric_key IN (
  'used_chats',
  'messages_count',
  'used_tokens',
  'tokens_used',
  'used_uploads',
  'uploads_count',
  'prediction_generations',
  'used_exams',
  'exams_count',
  'practice_exam_generations',
  'knowledge_generations'
);

COMMIT;
