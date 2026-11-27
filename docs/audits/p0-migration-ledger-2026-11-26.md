# P0 migration ledger reconciliation

Source: production migration ledger (read only), compared to main 495935d and the P0 branch. The six recovered SQL statements retain their recorded production version numbers. The four policy/index migrations retain exact ledger SQL in `migration-ledger-originals/`; active replay copies guard absent legacy relations and absent ALTER POLICY targets. CI identified `au_auth_mappings` as absent from the clean local-first schema. This compatibility adaptation is not evidence of full production parity. The following two repository-only names were replaced after comparing SQL with blank-line normalization:

- `20261118090000_mobile_auth_handoffs.sql` → `20261118173850_mobile_auth_handoffs.sql`
- `20261122175339_mobile_device_authorization.sql` → `20261123043639_mobile_device_authorization.sql`

The other four are recovered policy/index migrations. No production ledger or schema was changed. Existing non-production databases that recorded the former timestamps require a reviewed reconciliation before upgrades; never blindly replay or repair them. CI must prove the resulting chain on an isolated clean database. A green CI run does not prove schema equivalence to production.

## Version counts after proposed change

- Live versions: 186
- Repository files: 275
- Live versions missing from branch: 0
- Repository-only versions still to classify: 89

The following repository-only migrations have not been recorded in the inspected production ledger. This is an inventory, not authorization to run them. They may be superseded, unapplied, or incompatible. Review their SQL and actual schema effects individually. Do not push until disposition and recovery are verified.

- [ ] `20260827135000_admin_usage_adjustments.sql`
- [ ] `20260827144000_admin_usage_adjustments_idempotency.sql`
- [ ] `20260827215500_admin_usage_adjustments_concurrency.sql`
- [ ] `20260828004500_usage_mutation_version_guard.sql`
- [ ] `20260828020000_legacy_usage_mutation_version_guard.sql`
- [ ] `20260828065500_admin_usage_legacy_checkpoint.sql`
- [ ] `20260828074000_admin_usage_request_fingerprint.sql`
- [ ] `20260828082500_admin_usage_integer_guard.sql`
- [ ] `20260828095000_document_owner_usage_mutation_guard.sql`
- [ ] `20260829204500_revoke_legacy_admin_usage_rpc.sql`
- [ ] `20260829211500_revoke_internal_admin_usage_rpcs.sql`
- [ ] `20260829215500_ai_reservation_admin_adjustments.sql`
- [ ] `20260830024500_usage_event_mutation_version_guard.sql`
- [ ] `20260830055000_ai_usage_commit_admission_window.sql`
- [ ] `20260830064500_ai_reservation_window_freshness.sql`
- [ ] `20260830075500_admin_usage_inflight_reservation_guard.sql`
- [ ] `20260830084500_ai_usage_commit_reservation_snapshot_lock.sql`
- [ ] `20260830094500_ai_usage_event_namespace_guard.sql`
- [ ] `20260830105000_restore_admin_usage_checkpoint_guard.sql`
- [ ] `20260830114000_restore_admin_usage_replay_guard.sql`
- [ ] `20260830124500_admin_usage_wrapper_authorization.sql`
- [ ] `20260830134500_ai_usage_terminal_lock_order.sql`
- [ ] `20260830144500_ai_usage_provider_started_expiry.sql`
- [ ] `20260830154500_ai_usage_attempt_lease_refresh.sql`
- [ ] `20260830164000_ai_usage_release_attempt_binding.sql`
- [ ] `20260830174500_ai_usage_commit_attempt_binding.sql`
- [ ] `20260830184500_ai_usage_ticket_reissue_acceptance.sql`
- [ ] `20260830194500_ai_usage_replay_usage_day_lock.sql`
- [ ] `20260830204500_ai_usage_commit_lease_expiry.sql`
- [ ] `20260830214500_admin_usage_advisory_before_version.sql`
- [ ] `20260831004500_admin_usage_delta_direction_guard.sql`
- [ ] `20260831014500_ai_usage_same_ticket_takeover_guard.sql`
- [ ] `20260831024500_admin_usage_delta_magnitude_guard.sql`
- [ ] `20260831034500_admin_usage_active_window_guard.sql`
- [ ] `20260831044500_usage_window_wall_clock_freshness.sql`
- [ ] `20260831054500_ai_usage_commit_wall_clock_expiry.sql`
- [ ] `20260831064500_ai_usage_effective_expiry_backfill.sql`
- [ ] `20260831074500_ai_tier_quota_wall_clock_freshness.sql`
- [ ] `20260831084500_ai_usage_begin_wall_clock_freshness.sql`
- [ ] `20260831094500_ai_usage_takeover_window_guard.sql`
- [ ] `20260831114500_admin_usage_actor_email_attribution.sql`
- [ ] `20260831125500_admin_usage_cumulative_safe_integer_guard.sql`
- [ ] `20260831140500_ai_usage_provider_start_window_guard.sql`
- [ ] `20260831164500_admin_usage_active_window_wall_clock.sql`
- [ ] `20260831194500_ai_usage_first_start_stale_release.sql`
- [ ] `20260831204500_admin_usage_batch_request_id_guard.sql`
- [ ] `20260831214500_admin_usage_noop_idempotency_receipt.sql`
- [ ] `20260831224000_admin_usage_noop_receipt_constraint.sql`
- [ ] `20260831234000_admin_usage_completed_replay_fast_path.sql`
- [ ] `20260901004500_admin_usage_batch_completed_replay_fast_path.sql`
- [ ] `20260901014500_admin_usage_decrease_noop_receipt.sql`
- [ ] `20260901024000_admin_usage_decrease_requested_amount_fingerprint.sql`
- [ ] `20260901034500_admin_usage_request_id_serialization.sql`
- [ ] `20260901064500_admin_usage_reason_replay_fingerprint.sql`
- [ ] `20260901074500_admin_usage_target_replay_fingerprint.sql`
- [ ] `20260901084500_usage_accounting_user_serialization.sql`
- [ ] `20260901094500_admin_usage_decrease_requested_amount_required.sql`
- [ ] `20260901104500_ai_usage_terminal_user_serialization.sql`
- [ ] `20260901124500_ai_usage_expiry_user_serialization.sql`
- [ ] `20260901154500_ai_usage_expiry_effective_lease_guard.sql`
- [ ] `20260901164500_usage_event_user_serialization.sql`
- [ ] `20260902144000_billing_legacy_subscription_compat.sql`
- [ ] `20260902165500_scope_service_role_rls_policies.sql`
- [ ] `20260902194500_protect_profile_privileged_columns.sql`
- [ ] `20260902205500_remove_unsafe_guest_worker_policies.sql`
- [ ] `20260903000000_restrict_finalize_document_upload.sql`
- [ ] `20260903034500_enforce_worker_job_document_source.sql`
- [ ] `20260903065000_track_worker_terminal_usage_events.sql`
- [ ] `20260903094500_worker_usage_plan_attribution.sql`
- [ ] `20260903164000_meter_indexed_ingestion_chunks.sql`
- [ ] `20260903184500_allow_premium_retention_tier.sql`
- [ ] `20260904084500_admin_usage_reset_all_root_receipt.sql`
- [ ] `20260904194500_admin_usage_actor_deletion_audit.sql`
- [ ] `20260904214500_usage_mutation_delete_parent_guard.sql`
- [ ] `20260907024500_admin_usage_reset_delta_guard.sql`
- [ ] `20260907055000_admin_usage_plan_rule_window_guard.sql`
- [ ] `20260907104500_admin_usage_checkpoint_rule_source.sql`
- [ ] `20260907125000_admin_usage_checkpoint_canonical_baseline.sql`
- [ ] `20260907164500_ai_usage_alias_aware_admission.sql`
- [ ] `20260907184500_admin_usage_service_role_only_mutations.sql`
- [ ] `20260908014500_admin_usage_increase_reservation_guard.sql`
- [ ] `20260908044500_usage_mutation_statement_order.sql`
- [ ] `20260908094000_ai_usage_replay_wall_clock_expiry.sql`
- [ ] `20261115222000_reconcile_effective_limits_usage_snapshot.sql`
- [ ] `20261115230500_revoke_public_admin_rpc_execution.sql`
- [ ] `20261115231100_reassert_server_only_admin_rpc_grants.sql`
- [ ] `20261115233400_bind_effective_entitlements_to_authenticated_subject.sql`
- [ ] `20261115233800_reassert_effective_limits_runtime_guard.sql`
- [ ] `20261115234000_add_ai_usage_event_provider_metadata.sql`
