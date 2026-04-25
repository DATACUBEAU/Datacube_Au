-- Migration: Drop au_direct_messages in favor of Firebase Firestore
-- 20260207070000_drop_direct_messages.sql

DROP TABLE IF EXISTS au_direct_messages CASCADE;
