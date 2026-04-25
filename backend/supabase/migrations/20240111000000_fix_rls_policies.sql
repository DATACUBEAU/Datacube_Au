-- =====================================================
-- Fix RLS Policies for Security and Performance
-- Date: 2024-01-11
-- Purpose: Add missing policies, fix performance issues,
--          and ensure proper access control
-- =====================================================

-- =====================================================
-- 1. FIX au_document_chunks: INSERT / UPDATE / DELETE
-- =====================================================
-- Drop old policies first
DROP POLICY IF EXISTS "Users can insert own chunks" ON au_document_chunks;
DROP POLICY IF EXISTS "Users can update own chunks" ON au_document_chunks;
DROP POLICY IF EXISTS "Users can delete own chunks" ON au_document_chunks;
DROP POLICY IF EXISTS "Users can view own chunks" ON au_document_chunks;

-- Create policies
CREATE POLICY "Users can insert own chunks"
  ON au_document_chunks
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own chunks"
  ON au_document_chunks
  FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own chunks"
  ON au_document_chunks
  FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can view own chunks"
  ON au_document_chunks
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);


-- =====================================================
-- 2. FIX au_documents: INSERT / UPDATE / DELETE / SELECT
-- =====================================================
DROP POLICY IF EXISTS "Users can view own documents" ON au_documents;
DROP POLICY IF EXISTS "Users can insert own documents" ON au_documents;
DROP POLICY IF EXISTS "Users can delete own documents" ON au_documents;
DROP POLICY IF EXISTS "Users can update own documents" ON au_documents;

-- Create policies
CREATE POLICY "Users can view own documents"
  ON au_documents
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own documents"
  ON au_documents
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own documents"
  ON au_documents
  FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own documents"
  ON au_documents
  FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);


-- =====================================================
-- 3. FIX au_upload_jobs: INSERT / UPDATE / DELETE / SELECT
-- =====================================================
DROP POLICY IF EXISTS "Users can view own upload jobs" ON au_upload_jobs;
DROP POLICY IF EXISTS "Users can insert own upload jobs" ON au_upload_jobs;
DROP POLICY IF EXISTS "Users can update own upload jobs" ON au_upload_jobs;
DROP POLICY IF EXISTS "Users can delete own upload jobs" ON au_upload_jobs;

-- Create policies
CREATE POLICY "Users can view own upload jobs"
  ON au_upload_jobs
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own upload jobs"
  ON au_upload_jobs
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own upload jobs"
  ON au_upload_jobs
  FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own upload jobs"
  ON au_upload_jobs
  FOR DELETE
  USING ((SELECT auth.uid()) = user_id);
