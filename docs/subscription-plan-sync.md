# Subscription Plan Synchronization

## Quota rules

- Upload count, document count, and storage usage are fixed caps. They do not reset daily.
- Chat count and token usage reset at `00:00 UTC` every day.
- Exam generation limits are lifetime caps unless the plan metadata is changed explicitly.
- Default token ceilings are intentionally conservative:
  - Free: `4,000`
  - Pro: `18,000`
  - Premium: `45,000`

## Expiration windows

- Free: `14 days`
- Promo Pro: `14 days`
- Paid Pro: `30 days`
- Premium: `30 days`
- Signed-out cleanup: `7 days`

## Synchronization pattern

- `public.apply_plan_transition(...)` is the canonical database transition entrypoint.
- The function acquires a per-user advisory transaction lock before updating state.
- A transition updates these records in one database transaction:
  - `au_user_entitlements`
  - `au_user_profiles`
  - `billing_subscriptions` when subscription payload is provided
  - `au_documents.expires_at` for root documents plus inherited child expiry
  - `au_plan_transitions`
  - `entitlement_audit`
- Existing document expiry is prorated during plan changes:
  - Upgrades extend the remaining window proportionally.
  - Downgrades shrink the remaining window proportionally.

## Realtime propagation

- Limits, entitlement, and billing UI surfaces refresh from the same plan metadata and entitlement source.
- Plan changes propagate through realtime table updates on:
  - `au_user_entitlements`
  - `au_user_profiles`
  - `au_plan_transitions`
  - existing usage and subscription tables
- Public pricing and subscription cards read expiration values from `au_plan_metadata`.

## Rollback behavior

- The billing success path inserts the entitlement grant first.
- If plan synchronization fails, the new grant is deleted before the error is rethrown.
- Database-side transition failures roll back automatically because the transition function runs in a single transaction.

## Tests

- `tests/subscription-sync.unit.test.ts`
  - UTC reset window logic
  - expiration policy mapping
  - proration for upgrade and downgrade paths
  - in-memory integration coverage for transition sync and per-user serialization
- `tests/pricing-plan-expiration.spec.ts`
  - public UI assertion for `14 days` and `30 days` expiration copy
