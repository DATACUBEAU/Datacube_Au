-- Migration: Add unique constraint to admin sessions IP
-- 20260130000001_unique_admin_ip.sql

ALTER TABLE au_admin_sessions ADD CONSTRAINT au_admin_sessions_ip_address_key UNIQUE (ip_address);
