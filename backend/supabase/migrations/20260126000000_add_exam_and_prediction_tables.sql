-- Migration: Add Exam and Prediction Tables
-- Description: Creates tables to store generated practice exams and exam predictions for persistence.
-- Date: 2026-01-26

-- 1. AU Exams Table
CREATE TABLE IF NOT EXISTS au_exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users,
  guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE,
  document_id UUID REFERENCES au_documents(id) ON DELETE CASCADE,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. AU Predictions Table
CREATE TABLE IF NOT EXISTS au_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users,
  guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE,
  document_id UUID REFERENCES au_documents(id) ON DELETE CASCADE,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. AU Knowledge Table
CREATE TABLE IF NOT EXISTS au_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users,
  guest_session_id UUID REFERENCES au_guest_sessions(id) ON DELETE CASCADE,
  document_id UUID REFERENCES au_documents(id) ON DELETE CASCADE,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Disable RLS (as per AU security policy)
ALTER TABLE au_exams DISABLE ROW LEVEL SECURITY;
ALTER TABLE au_predictions DISABLE ROW LEVEL SECURITY;
ALTER TABLE au_knowledge DISABLE ROW LEVEL SECURITY;

-- 5. Indexes for performance
CREATE INDEX IF NOT EXISTS au_exams_user_id_idx ON au_exams(user_id);
CREATE INDEX IF NOT EXISTS au_exams_guest_session_id_idx ON au_exams(guest_session_id);
CREATE INDEX IF NOT EXISTS au_exams_document_id_idx ON au_exams(document_id);

CREATE INDEX IF NOT EXISTS au_predictions_user_id_idx ON au_predictions(user_id);
CREATE INDEX IF NOT EXISTS au_predictions_guest_session_id_idx ON au_predictions(guest_session_id);
CREATE INDEX IF NOT EXISTS au_predictions_document_id_idx ON au_predictions(document_id);

CREATE INDEX IF NOT EXISTS au_knowledge_user_id_idx ON au_knowledge(user_id);
CREATE INDEX IF NOT EXISTS au_knowledge_guest_session_id_idx ON au_knowledge(guest_session_id);
CREATE INDEX IF NOT EXISTS au_knowledge_document_id_idx ON au_knowledge(document_id);
