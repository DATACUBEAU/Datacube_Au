CREATE TABLE IF NOT EXISTS au_model_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  feature TEXT NOT NULL,
  model_id TEXT NOT NULL,
  prompt_tokens INT,
  completion_tokens INT,
  total_tokens INT,
  cost DOUBLE PRECISION,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE au_model_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own model usage" ON au_model_usage
  FOR SELECT USING (auth.uid() = user_id);
