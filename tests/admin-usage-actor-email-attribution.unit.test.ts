import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260831114500_admin_usage_actor_email_attribution.sql',
  'utf8',
);

// Audit attribution must be derived from the verified actor UUID at the database
// boundary rather than trusting the caller-supplied human-readable email.
assert.match(
  migration,
  /SELECT NULLIF\(TRIM\(email\), ''\)[\s\S]+FROM auth\.users[\s\S]+WHERE id = NEW\.actor_user_id/i,
);
assert.match(migration, /NEW\.actor_email := v_actor_email/i);
assert.doesNotMatch(migration, /NEW\.actor_email\s*:=\s*COALESCE\([^;]*NEW\.actor_email/i);

// Protect every ledger write path, including direct service-side inserts, and
// re-canonicalize any attempted actor/email update rather than allowing spoofing.
assert.match(
  migration,
  /BEFORE INSERT OR UPDATE OF actor_user_id, actor_email[\s\S]+ON public\.au_usage_admin_adjustments/i,
);
assert.match(
  migration,
  /EXECUTE FUNCTION public\.canonicalize_usage_adjustment_actor_email\(\)/i,
);

// The trigger helper is not a PostgREST-callable mutation surface.
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.canonicalize_usage_adjustment_actor_email\(\) FROM PUBLIC, anon, authenticated/i,
);

// Keep audit hardening non-destructive.
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(
  migration,
  /DELETE\s+FROM\s+public\.(?:au_usage_events|usage_counters|usage_totals|au_usage_admin_adjustments)/i,
);
assert.doesNotMatch(migration, /DROP\s+TABLE/i);

console.log('admin usage actor-email attribution regressions passed');
