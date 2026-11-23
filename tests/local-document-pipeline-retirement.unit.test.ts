import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const retirement = readFileSync(
  'supabase/migrations/20261115183703_retire_legacy_document_pipeline_local_first.sql',
  'utf8',
);
assert.match(retirement, /drop table if exists public\.au_worker_jobs cascade;/i);
assert.match(retirement, /drop function if exists public\.claim_worker_job\(text, integer\);/i);
assert.match(retirement, /drop function if exists public\.claim_upload_job\(\);/i);
assert.match(retirement, /revoke all privileges on table public\.au_documents from public, anon, authenticated, service_role;/i);

const upload = readFileSync('src/app/api/au/document-upload/route.ts', 'utf8');
assert.match(upload, /export async function POST\(\)\s*\{\s*return localOnlyResponse\(\);/);
assert.match(upload, /export async function GET\(\)\s*\{\s*return localOnlyResponse\(\);/);
assert.match(upload, /status: 410/);
assert.match(upload, /'Cache-Control': 'no-store, private'/);
console.log('PASS legacy worker claims are retired and web uploads fail closed');
