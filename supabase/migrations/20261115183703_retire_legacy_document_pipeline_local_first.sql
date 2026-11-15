-- Retire the legacy server-side document/RAG pipeline.
-- AU documents, parsing, chunking, embeddings, indexing and retrieval now belong on-device.
-- Preserve Supabase Auth, billing, entitlements, model routing, au_messages, au_sessions and shared logs.

drop view if exists public.au_upload_jobs;

drop table if exists public.au_document_insights cascade;
drop table if exists public.au_document_chunks cascade;
drop table if exists public.au_document_versions cascade;
drop table if exists public.au_worker_jobs cascade;
drop table if exists public.au_retention_actions cascade;
drop table if exists public.au_retention_leases cascade;
drop table if exists public.au_retention_runs cascade;
drop table if exists public.au_upload_audit_log cascade;
drop table if exists public.au_deletion_log cascade;
drop table if exists public.au_feature_outputs cascade;
drop table if exists public.au_practice_attempts cascade;
drop table if exists public.au_answer_cache cascade;
drop table if exists public.au_rag_settings cascade;
drop table if exists public.au_documents cascade;

alter table if exists public.au_debug_logs drop column if exists document_id;

drop function if exists public.au_vector_search(vector, double precision, integer, uuid, uuid);
drop function if exists public.au_vector_search(vector, double precision, integer, uuid);
drop function if exists public.match_documents(vector, double precision, integer, uuid);
drop function if exists public.claim_upload_job();
drop function if exists public.claim_worker_job(text, integer);
drop function if exists public.cleanup_retention_data(boolean);
drop function if exists public.finalize_document_upload(uuid, uuid, uuid, uuid, text, text, text, text, bigint, jsonb, text);
drop function if exists public.log_document_deletion();
drop function if exists public.sync_au_worker_job_lifecycle_fields();
drop function if exists public.touch_au_retention_action_updated_at();
drop function if exists public.inherit_attachment_expiry_from_parent();
drop function if exists public.try_claim_retention_lease(text, text, integer);
drop function if exists public.release_retention_lease(text, text);
drop function if exists public.trigger_process_upload_job();

-- Keep pgvector installed while any retained table (for example legacy
-- au_document_embeddings) still has vector-typed columns. Extension retirement
-- is a separate, dependency-verified cleanup after those tables are migrated.
