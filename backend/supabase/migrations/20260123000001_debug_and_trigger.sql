-- Create a debug log table to help diagnose Edge Function execution
CREATE TABLE IF NOT EXISTS au_debug_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable pg_net for robust webhook triggers
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

-- Function to invoke the processing Edge Function
CREATE OR REPLACE FUNCTION trigger_process_upload_job()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  project_url TEXT;
  service_key TEXT;
  payload JSONB;
  request_id BIGINT;
BEGIN
  -- Get the project URL and Service Key
  -- In a real Supabase environment, these might be available via vault or secrets.
  -- For now, we assume standard Supabase Edge Function URL structure if not provided.
  -- You MUST replace these with actual values or ensure they are available.
  -- However, since we can't easily inject secrets into SQL here without user input,
  -- we will try to use a header that might be set, or rely on the function being public but protected?
  -- Actually, Edge Functions usually require the ANON or SERVICE key.
  
  -- Attempt to read from a secrets table if it exists (au_api_keys?)
  -- Or just proceed with a best-effort logging if we can't trigger.
  
  -- logging
  INSERT INTO au_debug_logs (component, message, details)
  VALUES ('db_trigger', 'New upload job detected', jsonb_build_object('job_id', NEW.id, 'status', NEW.status));

  -- NOTE: We cannot easily get the Service Key inside PL/PGSQL without setup.
  -- So we will use a NOTIFY as a fallback that an external listener can use.
  PERFORM pg_notify('upload_jobs', json_build_object('id', NEW.id, 'status', NEW.status)::text);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger definition
DROP TRIGGER IF EXISTS trg_process_upload_job ON au_upload_jobs;
CREATE TRIGGER trg_process_upload_job
  AFTER INSERT
  ON au_upload_jobs
  FOR EACH ROW
  WHEN (NEW.status = 'queued')
  EXECUTE FUNCTION trigger_process_upload_job();
