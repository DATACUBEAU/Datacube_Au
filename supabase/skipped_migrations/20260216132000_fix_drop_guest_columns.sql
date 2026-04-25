DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'au_documents') THEN
    DROP POLICY IF EXISTS "Users can manage own documents" ON public.au_documents;
    DROP POLICY IF EXISTS "Users can view own documents" ON public.au_documents;
    DROP POLICY IF EXISTS "Users can insert own documents" ON public.au_documents;
    DROP POLICY IF EXISTS "Users can update own documents" ON public.au_documents;
    DROP POLICY IF EXISTS "Users can delete own documents" ON public.au_documents;
    DROP POLICY IF EXISTS "Guests can view own documents" ON public.au_documents;
    DROP POLICY IF EXISTS "Guests can insert own documents" ON public.au_documents;
    DROP POLICY IF EXISTS "Guests can update own documents" ON public.au_documents;
    DROP POLICY IF EXISTS "Guests can delete own documents" ON public.au_documents;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'au_upload_jobs') THEN
    DROP POLICY IF EXISTS "Users can view own upload jobs" ON public.au_upload_jobs;
    DROP POLICY IF EXISTS "Users can insert own upload jobs" ON public.au_upload_jobs;
    DROP POLICY IF EXISTS "Users can update own upload jobs" ON public.au_upload_jobs;
    DROP POLICY IF EXISTS "Users can delete own upload jobs" ON public.au_upload_jobs;
    DROP POLICY IF EXISTS "Guests can view own upload jobs" ON public.au_upload_jobs;
    DROP POLICY IF EXISTS "Guests can update own upload jobs" ON public.au_upload_jobs;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'au_document_chunks') THEN
    DROP POLICY IF EXISTS "Users can view own chunks" ON public.au_document_chunks;
    DROP POLICY IF EXISTS "Users can insert own chunks" ON public.au_document_chunks;
    DROP POLICY IF EXISTS "Users can update own chunks" ON public.au_document_chunks;
    DROP POLICY IF EXISTS "Users can delete own chunks" ON public.au_document_chunks;
    DROP POLICY IF EXISTS "Guests can view own chunks" ON public.au_document_chunks;
    DROP POLICY IF EXISTS "Guests can insert own chunks" ON public.au_document_chunks;
    DROP POLICY IF EXISTS "Guests can update own chunks" ON public.au_document_chunks;
    DROP POLICY IF EXISTS "Guests can delete own chunks" ON public.au_document_chunks;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'au_document_embeddings') THEN
    DROP POLICY IF EXISTS "Users can insert own embeddings" ON public.au_document_embeddings;
    DROP POLICY IF EXISTS "Users can update own embeddings" ON public.au_document_embeddings;
    DROP POLICY IF EXISTS "Users can delete own embeddings" ON public.au_document_embeddings;
    DROP POLICY IF EXISTS "Guests can view own embeddings" ON public.au_document_embeddings;
    DROP POLICY IF EXISTS "Guests can insert own embeddings" ON public.au_document_embeddings;
    DROP POLICY IF EXISTS "Guests can update own embeddings" ON public.au_document_embeddings;
    DROP POLICY IF EXISTS "Guests can delete own embeddings" ON public.au_document_embeddings;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'au_messages') THEN
    DROP POLICY IF EXISTS "Users can view own messages" ON public.au_messages;
    DROP POLICY IF EXISTS "Users can insert own messages" ON public.au_messages;
    DROP POLICY IF EXISTS "Users can manage own messages" ON public.au_messages;
    DROP POLICY IF EXISTS "Guests can view own messages" ON public.au_messages;
    DROP POLICY IF EXISTS "Guests can insert own messages" ON public.au_messages;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'au_sessions') THEN
    DROP POLICY IF EXISTS "Users can view own sessions" ON public.au_sessions;
    DROP POLICY IF EXISTS "Users can insert own sessions" ON public.au_sessions;
    DROP POLICY IF EXISTS "Users can update own sessions" ON public.au_sessions;
    DROP POLICY IF EXISTS "Users can delete own sessions" ON public.au_sessions;
    DROP POLICY IF EXISTS "Users can manage own sessions" ON public.au_sessions;
    DROP POLICY IF EXISTS "Guests can view own sessions" ON public.au_sessions;
    DROP POLICY IF EXISTS "Guests can insert own sessions" ON public.au_sessions;
    DROP POLICY IF EXISTS "Guests can update own sessions" ON public.au_sessions;
    DROP POLICY IF EXISTS "Guests can delete own sessions" ON public.au_sessions;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'au_model_usage') THEN
    DROP POLICY IF EXISTS "Users can view own model usage" ON public.au_model_usage;
  END IF;
END $$;

ALTER TABLE IF EXISTS public.au_upload_jobs DROP CONSTRAINT IF EXISTS au_upload_jobs_owner_chk;

ALTER TABLE IF EXISTS public.au_documents DROP COLUMN IF EXISTS guest_session_id;
ALTER TABLE IF EXISTS public.au_upload_jobs DROP COLUMN IF EXISTS guest_session_id;
ALTER TABLE IF EXISTS public.au_sessions DROP COLUMN IF EXISTS guest_session_id;
ALTER TABLE IF EXISTS public.au_messages DROP COLUMN IF EXISTS guest_session_id;
ALTER TABLE IF EXISTS public.au_model_usage DROP COLUMN IF EXISTS guest_session_id;
ALTER TABLE IF EXISTS public.au_document_chunks DROP COLUMN IF EXISTS guest_session_id;
ALTER TABLE IF EXISTS public.au_user_activity DROP COLUMN IF EXISTS guest_session_id;

DROP TABLE IF EXISTS public.au_guest_sessions CASCADE;

DROP INDEX IF EXISTS public.au_upload_jobs_guest_session_id_idx;
DROP INDEX IF EXISTS public.au_documents_guest_session_id_idx;
DROP INDEX IF EXISTS public.au_messages_guest_session_id_idx;
DROP INDEX IF EXISTS public.au_sessions_guest_session_id_idx;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'au_documents') THEN
    CREATE POLICY "Users can manage own documents" ON public.au_documents
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'au_upload_jobs') THEN
    CREATE POLICY "Users can view own upload jobs" ON public.au_upload_jobs
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);

    CREATE POLICY "Users can insert own upload jobs" ON public.au_upload_jobs
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);

    CREATE POLICY "Users can update own upload jobs" ON public.au_upload_jobs
      FOR UPDATE TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);

    CREATE POLICY "Users can delete own upload jobs" ON public.au_upload_jobs
      FOR DELETE TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'au_document_chunks') THEN
    CREATE POLICY "Users can view own chunks" ON public.au_document_chunks
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);

    CREATE POLICY "Users can insert own chunks" ON public.au_document_chunks
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);

    CREATE POLICY "Users can update own chunks" ON public.au_document_chunks
      FOR UPDATE TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);

    CREATE POLICY "Users can delete own chunks" ON public.au_document_chunks
      FOR DELETE TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'au_sessions') THEN
    CREATE POLICY "Users can manage own sessions" ON public.au_sessions
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'au_messages') THEN
    CREATE POLICY "Users can manage own messages" ON public.au_messages
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'au_model_usage') THEN
    CREATE POLICY "Users can view own model usage" ON public.au_model_usage
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
