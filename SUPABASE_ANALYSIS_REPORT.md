# Supabase System Analysis Report
**Generated:** 2026-01-04  
**Project:** DataCube AU  
**Supabase Project:** dhmukdeljiwvvwjdcxgn.supabase.co

---

## Executive Summary

This report identifies **critical security vulnerabilities**, **performance bottlenecks**, **data integrity issues**, and **logic bugs** in the Supabase backend. The system has 12 Edge Functions, 12 database tables, and supports both authenticated users and guest sessions.

---

## 🔴 CRITICAL SECURITY ISSUES

### 1. **Function Search Path Mutable** (HIGH RISK)
**Affected Functions:**
- `public.au_vector_search`
- `public.match_documents`

**Issue:** Functions don't set `search_path`, making them vulnerable to search path injection attacks.

**Impact:** An attacker could manipulate the search path to execute malicious code.

**Fix Required:**
```sql
ALTER FUNCTION public.au_vector_search SET search_path = '';
ALTER FUNCTION public.match_documents SET search_path = '';
```

**Reference:** [Supabase Security Linter](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)

---

### 2. **Extension in Public Schema** (MEDIUM RISK)
**Issue:** The `vector` extension is installed in the `public` schema.

**Impact:** Extensions in public schema can be accessed by any user, increasing attack surface.

**Fix Required:** Move extension to a dedicated schema (e.g., `extensions`).

---

### 3. **Edge Functions JWT Verification Disabled** (HIGH RISK)
**Affected Functions:**
- `au-chat` (verify_jwt: false)
- `document-upload` (verify_jwt: false)
- `document-chunker` (verify_jwt: false)
- `embedding-generator` (verify_jwt: false)
- `vector-search` (verify_jwt: false)
- `rag-pipeline` (verify_jwt: false)
- `openrouter-proxy` (verify_jwt: false)
- `exam-generator` (verify_jwt: false)
- `prediction-engine` (verify_jwt: false)
- `generate-knowledge` (verify_jwt: false)
- `generate-prompt-starters` (verify_jwt: false)
- `guest-session` (verify_jwt: false) ✅ Expected
- `handshake` (verify_jwt: false) ✅ Expected

**Issue:** 11 out of 13 Edge Functions have JWT verification disabled, allowing unauthenticated access.

**Impact:** Functions can be called without authentication, potentially leading to:
- Unauthorized document processing
- API key exposure
- Resource exhaustion attacks
- Data leakage

**Fix Required:** Enable `verify_jwt = true` for all functions except `guest-session` and `handshake`, and implement proper authentication checks in function code.

**Note:** `process-upload-job` correctly has `verify_jwt: true`.

---

### 4. **Leaked Password Protection Disabled** (LOW-MEDIUM RISK)
**Issue:** Supabase Auth doesn't check passwords against HaveIBeenPwned.

**Impact:** Users can set compromised passwords.

**Fix Required:** Enable in Supabase Dashboard → Authentication → Password Security.

---

## ⚠️ PERFORMANCE ISSUES

### 5. **Missing Foreign Key Indexes** (HIGH IMPACT)
**Affected Tables:**
- `au_document_chunks`: `document_id`, `user_id`
- `au_document_embeddings`: `chunk_id`
- `au_documents`: `user_id`, `parent_id`, `guest_session_id`
- `au_messages`: `session_id`, `user_id`
- `au_sessions`: `user_id`, `guest_session_id`
- `au_upload_jobs`: `document_id`

**Impact:** Queries joining on these columns will be slow, especially as data grows.

**Fix Required:**
```sql
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON au_document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_user_id ON au_document_chunks(user_id);
CREATE INDEX IF NOT EXISTS idx_document_embeddings_chunk_id ON au_document_embeddings(chunk_id);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON au_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_parent_id ON au_documents(parent_id);
CREATE INDEX IF NOT EXISTS idx_documents_guest_session_id ON au_documents(guest_session_id);
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON au_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON au_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON au_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_guest_session_id ON au_sessions(guest_session_id);
CREATE INDEX IF NOT EXISTS idx_upload_jobs_document_id ON au_upload_jobs(document_id);
```

---

### 6. **RLS Policy Performance: Auth Function Re-evaluation** (MEDIUM IMPACT)
**Issue:** All RLS policies use `auth.uid()` directly, which is re-evaluated for each row.

**Affected Policies:** 30+ policies across all tables.

**Impact:** Significant performance degradation at scale (10x+ slower queries).

**Fix Required:** Replace `auth.uid()` with `(SELECT auth.uid())` in all policies.

**Example:**
```sql
-- BEFORE (slow)
CREATE POLICY "Users can view own documents" ON au_documents
  FOR SELECT USING (auth.uid() = user_id);

-- AFTER (fast)
CREATE POLICY "Users can view own documents" ON au_documents
  FOR SELECT USING ((SELECT auth.uid()) = user_id);
```

**Reference:** [Supabase RLS Performance Guide](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select)

---

### 7. **Multiple Permissive Policies** (MEDIUM IMPACT)
**Issue:** Tables have multiple permissive policies for the same role/action, causing all policies to be evaluated.

**Affected Tables:**
- `au_documents`: 2 policies per action (Users + Guests)
- `au_document_chunks`: 2 policies per action
- `au_messages`: 2 policies per action
- `au_sessions`: 2 policies per action

**Impact:** Each query evaluates 2 policies instead of 1, doubling RLS overhead.

**Fix Required:** Combine policies using `OR` conditions:
```sql
-- BEFORE (2 policies)
CREATE POLICY "Users can view own documents" ... USING (auth.uid() = user_id);
CREATE POLICY "Guests can view own documents" ... USING (guest_session_id::text = ...);

-- AFTER (1 policy)
CREATE POLICY "Users or guests can view own documents" ... USING (
  (SELECT auth.uid()) = user_id OR
  guest_session_id::text = (current_setting('request.jwt.claims', true)::jsonb ->> 'guest_session_id')
);
```

---

### 8. **Unused Index** (LOW IMPACT)
**Issue:** Index `au_upload_jobs_status_idx` exists but is never used.

**Impact:** Wasted storage and maintenance overhead.

**Fix Required:** Remove if not needed, or verify query patterns.

---

## 🐛 DATA INTEGRITY ISSUES

### 9. **Orphaned Documents Stuck in Processing**
**Current State:**
- 2 documents in `processing` status with 0 chunks, 0 embeddings, 0 upload_jobs
- 2 documents in `uploading` status with 0 chunks, 0 embeddings, 0 upload_jobs
- 1 document in `failed` status

**Issue:** Documents are created but never processed, or processing failed silently.

**Root Causes:**
1. `process-upload-job` Edge Function may be failing
2. No retry mechanism for failed processing
3. No cleanup job for stuck documents

**Fix Required:**
1. Add monitoring/alerting for stuck documents
2. Implement retry logic with exponential backoff
3. Create a cleanup job to mark documents as `failed` after timeout (e.g., 1 hour)

---

### 10. **Missing Upload Job Records**
**Issue:** Documents exist but have no corresponding `au_upload_jobs` records.

**Impact:** Cannot track upload progress or retry failed uploads.

**Fix Required:** Ensure `enqueueUploads` always creates both `au_documents` and `au_upload_jobs` records atomically.

---

### 11. **No Guest Session Cleanup**
**Issue:** `au_guest_sessions` table has no active cleanup mechanism (pg_cron may not be enabled).

**Impact:** Expired guest sessions accumulate, wasting storage.

**Fix Required:** Verify pg_cron is enabled, or implement manual cleanup via Edge Function.

---

## 🔧 LOGIC BUGS

### 12. **Storage Bucket Mismatch**
**Issue:** Codebase uses bucket `'documents'` but migration creates `'DataCube'` bucket. Both buckets exist with similar policies.

**Impact:** Confusion about which bucket to use, potential upload failures.

**Fix Required:** Standardize on one bucket name or document the dual-bucket strategy.

---

### 13. **RPC Functions Don't Support Guest Sessions**
**Issue:** `au_vector_search` and `match_documents` only accept `p_user_id`, not guest sessions.

**Impact:** Guest users cannot use RAG/vector search features.

**Fix Required:** Add optional `p_guest_session_id` parameter and update logic:
```sql
CREATE OR REPLACE FUNCTION public.au_vector_search(
  query_embedding vector,
  match_threshold double precision,
  match_count integer,
  p_user_id uuid DEFAULT NULL,
  p_guest_session_id uuid DEFAULT NULL
) RETURNS TABLE(...)
AS $$
BEGIN
  RETURN QUERY
  SELECT ...
  FROM au_document_embeddings e
  JOIN au_document_chunks c ON e.chunk_id = c.id
  JOIN au_documents d ON c.document_id = d.id
  WHERE (
    (p_user_id IS NOT NULL AND d.user_id = p_user_id) OR
    (p_guest_session_id IS NOT NULL AND d.guest_session_id = p_guest_session_id)
  )
  AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

---

### 14. **Guest Upload Reliability**
**Issue:** `process-upload-job` requires `JWT_SECRET` environment variable for guest JWT verification. If not set, guest uploads fail.

**Impact:** Guest users cannot upload documents if `JWT_SECRET` is misconfigured.

**Fix Required:** Add validation and clear error messages if `JWT_SECRET` is missing.

---

## 📊 SYSTEM METRICS

### Current Database State
- **Documents:** 5 total
  - 2 in `processing` (stuck)
  - 2 in `uploading` (stuck)
  - 1 in `failed`
- **Chunks:** 0 (no documents successfully processed)
- **Embeddings:** 0
- **Upload Jobs:** 0 (orphaned documents)
- **Sessions:** 0
- **Messages:** 0
- **Guest Sessions:** 0

### Edge Functions
- **Total:** 13 functions
- **JWT Protected:** 1 (`process-upload-job`)
- **JWT Disabled:** 12 (security risk)

### Migrations
- **Total:** 8 migrations applied
- **Latest:** `storage_policy_bucket` (20240108)

---

## ✅ RECOMMENDED ACTION PLAN

### Priority 1 (Critical - Fix Immediately)
1. ✅ Enable JWT verification on all Edge Functions (except guest-session/handshake)
2. ✅ Fix function search_path security issue
3. ✅ Add missing foreign key indexes
4. ✅ Fix RLS policy performance (use SELECT subquery)

### Priority 2 (High - Fix This Week)
5. ✅ Move vector extension to dedicated schema
6. ✅ Combine duplicate RLS policies
7. ✅ Fix RPC functions to support guest sessions
8. ✅ Implement document processing retry logic
9. ✅ Add cleanup job for stuck documents

### Priority 3 (Medium - Fix This Month)
10. ✅ Enable leaked password protection
11. ✅ Standardize storage bucket usage
12. ✅ Add monitoring/alerting for failed jobs
13. ✅ Verify guest session cleanup is working

---

## 📝 NOTES

- **Anonymous Access Policies:** The security advisor flags anonymous access, but this is **by design** for the guest system. These warnings can be ignored.
- **Multiple Permissive Policies:** While flagged as a performance issue, the current design (separate policies for users/guests) is more maintainable. Consider combining only if performance becomes a bottleneck.
- **Storage Buckets:** Both `documents` and `DataCube` buckets exist. Verify which one is actually used in production code.

---

## 🔗 REFERENCES

- [Supabase Security Best Practices](https://supabase.com/docs/guides/database/database-advisors)
- [RLS Performance Optimization](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select)
- [Function Search Path Security](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)

---

**Report Generated by:** Supabase MCP Analysis Tool  
**Next Review:** After implementing Priority 1 fixes
