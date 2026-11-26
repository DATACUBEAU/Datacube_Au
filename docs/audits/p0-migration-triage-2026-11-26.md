# P0 migration triage and authorization audit

Read-only catalog comparison, 2026-11-26. All 89 versions remain absent from the live migration ledger. The groups below classify review ownership by filename, NOT whether a migration is safe to replay. No production data or migration history was changed.

## Administrative usage mutations (43)

- 20260827135000_admin_usage_adjustments.sql
- 20260827144000_admin_usage_adjustments_idempotency.sql
- 20260827215500_admin_usage_adjustments_concurrency.sql
- 20260828004500_usage_mutation_version_guard.sql
- 20260828020000_legacy_usage_mutation_version_guard.sql
- 20260828065500_admin_usage_legacy_checkpoint.sql
- 20260828074000_admin_usage_request_fingerprint.sql
- 20260828082500_admin_usage_integer_guard.sql
- 20260829204500_revoke_legacy_admin_usage_rpc.sql
- 20260829211500_revoke_internal_admin_usage_rpcs.sql
- 20260829215500_ai_reservation_admin_adjustments.sql
- 20260830075500_admin_usage_inflight_reservation_guard.sql
- 20260830105000_restore_admin_usage_checkpoint_guard.sql
- 20260830114000_restore_admin_usage_replay_guard.sql
- 20260830124500_admin_usage_wrapper_authorization.sql
- 20260830214500_admin_usage_advisory_before_version.sql
- 20260831004500_admin_usage_delta_direction_guard.sql
- 20260831024500_admin_usage_delta_magnitude_guard.sql
- 20260831034500_admin_usage_active_window_guard.sql
- 20260831114500_admin_usage_actor_email_attribution.sql
- 20260831125500_admin_usage_cumulative_safe_integer_guard.sql
- 20260831164500_admin_usage_active_window_wall_clock.sql
- 20260831204500_admin_usage_batch_request_id_guard.sql
- 20260831214500_admin_usage_noop_idempotency_receipt.sql
- 20260831224000_admin_usage_noop_receipt_constraint.sql
- 20260831234000_admin_usage_completed_replay_fast_path.sql
- 20260901004500_admin_usage_batch_completed_replay_fast_path.sql
- 20260901014500_admin_usage_decrease_noop_receipt.sql
- 20260901024000_admin_usage_decrease_requested_amount_fingerprint.sql
- 20260901034500_admin_usage_request_id_serialization.sql
- 20260901064500_admin_usage_reason_replay_fingerprint.sql
- 20260901074500_admin_usage_target_replay_fingerprint.sql
- 20260901094500_admin_usage_decrease_requested_amount_required.sql
- 20260904084500_admin_usage_reset_all_root_receipt.sql
- 20260904194500_admin_usage_actor_deletion_audit.sql
- 20260904214500_usage_mutation_delete_parent_guard.sql
- 20260907024500_admin_usage_reset_delta_guard.sql
- 20260907055000_admin_usage_plan_rule_window_guard.sql
- 20260907104500_admin_usage_checkpoint_rule_source.sql
- 20260907125000_admin_usage_checkpoint_canonical_baseline.sql
- 20260907184500_admin_usage_service_role_only_mutations.sql
- 20260908014500_admin_usage_increase_reservation_guard.sql
- 20260908044500_usage_mutation_statement_order.sql

## Legacy document/worker and retention (8)

- 20260828095000_document_owner_usage_mutation_guard.sql
- 20260902205500_remove_unsafe_guest_worker_policies.sql
- 20260903000000_restrict_finalize_document_upload.sql
- 20260903034500_enforce_worker_job_document_source.sql
- 20260903065000_track_worker_terminal_usage_events.sql
- 20260903094500_worker_usage_plan_attribution.sql
- 20260903164000_meter_indexed_ingestion_chunks.sql
- 20260903184500_allow_premium_retention_tier.sql

## AI reservation and usage ledger (29)

- 20260830024500_usage_event_mutation_version_guard.sql
- 20260830055000_ai_usage_commit_admission_window.sql
- 20260830064500_ai_reservation_window_freshness.sql
- 20260830084500_ai_usage_commit_reservation_snapshot_lock.sql
- 20260830094500_ai_usage_event_namespace_guard.sql
- 20260830134500_ai_usage_terminal_lock_order.sql
- 20260830144500_ai_usage_provider_started_expiry.sql
- 20260830154500_ai_usage_attempt_lease_refresh.sql
- 20260830164000_ai_usage_release_attempt_binding.sql
- 20260830174500_ai_usage_commit_attempt_binding.sql
- 20260830184500_ai_usage_ticket_reissue_acceptance.sql
- 20260830194500_ai_usage_replay_usage_day_lock.sql
- 20260830204500_ai_usage_commit_lease_expiry.sql
- 20260831014500_ai_usage_same_ticket_takeover_guard.sql
- 20260831044500_usage_window_wall_clock_freshness.sql
- 20260831054500_ai_usage_commit_wall_clock_expiry.sql
- 20260831064500_ai_usage_effective_expiry_backfill.sql
- 20260831074500_ai_tier_quota_wall_clock_freshness.sql
- 20260831084500_ai_usage_begin_wall_clock_freshness.sql
- 20260831094500_ai_usage_takeover_window_guard.sql
- 20260831140500_ai_usage_provider_start_window_guard.sql
- 20260831194500_ai_usage_first_start_stale_release.sql
- 20260901084500_usage_accounting_user_serialization.sql
- 20260901104500_ai_usage_terminal_user_serialization.sql
- 20260901124500_ai_usage_expiry_user_serialization.sql
- 20260901154500_ai_usage_expiry_effective_lease_guard.sql
- 20260901164500_usage_event_user_serialization.sql
- 20260907164500_ai_usage_alias_aware_admission.sql
- 20260908094000_ai_usage_replay_wall_clock_expiry.sql

## Billing and access policy (3)

- 20260902144000_billing_legacy_subscription_compat.sql
- 20260902165500_scope_service_role_rls_policies.sql
- 20260902194500_protect_profile_privileged_columns.sql

## November runtime reconciliation (6)

- 20261115222000_reconcile_effective_limits_usage_snapshot.sql
- 20261115230500_revoke_public_admin_rpc_execution.sql
- 20261115231100_reassert_server_only_admin_rpc_grants.sql
- 20261115233400_bind_effective_entitlements_to_authenticated_subject.sql
- 20261115233800_reassert_effective_limits_runtime_guard.sql
- 20261115234000_add_ai_usage_event_provider_metadata.sql

## Verified live effects and dispositions

| Version | Evidence | Disposition |
| --- | --- | --- |
| 20261115222000 | Effective-limits function body matches after whitespace normalization | Candidate already represented; review complete definition and dependencies before ledger changes |
| 20261115230500 | Three admin read RPCs are already service-only; feature-flag RPC still supports authenticated callers with internal admin guard | Partial overlap; do not replay wholesale because it would restore client access to admin read RPCs |
| 20261115231100 | Three admin read RPC grants match intended service-only access | Observed effect present; verify all signatures before ledger disposition |
| 20261115233400 | Live entitlements function does not have the stricter null-subject denial in the repository version | Pending security delta; compare full definitions and validate callers in staging |
| 20261115233800 | Live limits function does not have the stricter null-subject denial in the repository version | Pending security delta; compare full definitions and validate callers in staging |
| 20261115234000 | All nine provider telemetry columns already exist | Partial equivalence; check types, comments and downstream code before disposition |
| 20260907184500 | Three versioned admin adjustment RPC names were not returned by the live catalog query | Missing dependency/implementation candidate; not a standalone grant migration |

## Remaining security findings

- Nine authenticated-callable SECURITY DEFINER functions, including the public username availability helper. Reviewed function bodies: preserve legitimate self-account and sign-up paths; require authorization tests and caller review before removing grants.
- The live metering event RPC still accepts authenticated callers; server-owned metering should be evaluated against all native, web and external worker clients before restricting it.
- 22 functions lack a fixed search_path. All inspected functions are SECURITY INVOKER. Review required object namespaces and callers before pinning; do not globally change paths.
- The legacy feature-flag client calls the existing RPC, so a blanket revoke of authenticated access is not safe without migration to the authorized server path.

The new isolated SQL assertions cover admin read RPC ACLs, cross-account entitlement/limit access and requests without a JWT subject. They do not replace a full two-user end-to-end test. A passing clean rebuild does not validate the production upgrade path.
