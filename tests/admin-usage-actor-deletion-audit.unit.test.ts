import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260904194500_admin_usage_actor_deletion_audit.sql',
  'utf8',
);
const versionDeletionGuard = readFileSync(
  'supabase/migrations/20260904214500_usage_mutation_delete_parent_guard.sql',
  'utf8',
);

// Historical adjustment rows must not permanently block deletion of an admin account.
assert.match(migration, /ALTER COLUMN actor_user_id DROP NOT NULL/);
assert.match(
  migration,
  /FOREIGN KEY \(actor_user_id\)[\s\S]+REFERENCES auth\.users\(id\)[\s\S]+ON DELETE SET NULL/,
);
assert.doesNotMatch(migration, /ON DELETE RESTRICT/);

// New adjustments still require a live verified actor; nullable actor_user_id is only
// a lifecycle state reached when the referenced auth user is later removed.
assert.match(
  migration,
  /IF NEW\.actor_user_id IS NULL THEN[\s\S]+IF TG_OP = 'INSERT' THEN[\s\S]+usage_adjustment_actor_required/,
);

// FK-driven nulling must preserve the canonical readable snapshot instead of erasing
// attribution after auth.users no longer contains the actor.
assert.match(
  migration,
  /NEW\.actor_email := COALESCE\([\s\S]+NEW\.actor_email[\s\S]+OLD\.actor_email[\s\S]+RETURN NEW/,
);

// While a live actor UUID exists, attribution remains canonicalized from auth.users
// and cannot be spoofed through the caller-supplied email parameter.
assert.match(
  migration,
  /SELECT NULLIF\(TRIM\(email\), ''\)[\s\S]+FROM auth\.users[\s\S]+WHERE id = NEW\.actor_user_id/,
);
assert.match(migration, /NEW\.actor_email := v_actor_email/);

// Cascaded deletion of usage rows must not recreate a mutation-version row whose
// parent auth.users record is being removed. Both the generic and document-specific
// trigger functions verify that the affected parent still exists before inserting.
assert.match(
  versionDeletionGuard,
  /v_old_user_id IS NOT NULL[\s\S]+EXISTS \(SELECT 1 FROM auth\.users WHERE id = v_old_user_id\)/,
);
assert.match(
  versionDeletionGuard,
  /v_new_user_id IS NOT NULL[\s\S]+EXISTS \(SELECT 1 FROM auth\.users WHERE id = v_new_user_id\)/,
);
assert.match(
  versionDeletionGuard,
  /WHERE candidate IS NOT NULL[\s\S]+EXISTS \(SELECT 1 FROM auth\.users WHERE id = candidate\)/,
);

// Normal versioning remains append/update-only; this lifecycle guard must not remove
// usage data, audit rows, or version rows directly.
assert.match(versionDeletionGuard, /ON CONFLICT \(user_id\) DO UPDATE/);
assert.doesNotMatch(versionDeletionGuard, /\bDELETE\s+FROM\b/i);
assert.doesNotMatch(versionDeletionGuard, /\bTRUNCATE\b/i);
assert.doesNotMatch(versionDeletionGuard, /\bDROP\s+TABLE\b/i);

// This lifecycle migration must preserve the append-only audit rows and production data.
assert.doesNotMatch(migration, /\bDELETE\s+FROM\s+public\.au_usage_admin_adjustments\b/i);
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i);

console.log('admin usage actor deletion audit regressions passed');
