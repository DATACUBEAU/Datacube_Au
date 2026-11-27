# Production migration reconciliation gate

Do not run production db push or migration repair solely because the local migration-chain CI is green. A fresh local schema and the actual production migration ledger are different checks.

1. Export the production migration **versions only** to a local JSON array using an authorized read-only connection. Keep credentials and SQL definitions out of logs and commits.
2. Run `node scripts/check-migration-history.mjs /path/to/live-versions.json` from the repository root. A nonzero exit is a reconciliation blocker, not permission to apply pending migrations.
3. For each missing version, recover its original reviewed SQL and compare its effects to the live schema. For repository-only versions, classify as unapplied, superseded, intentionally skipped, or incompatible. Do not infer applied state from the filename.
4. Rebuild an isolated database and compare schema, grants, RLS, triggers, functions and constraints against the approved target. Check upgrade from a representative existing schema as well as clean install.
5. Review backup and restore procedure, deployment ordering, and rollback. Obtain production approval before making any ledger or schema change; rerun the comparison afterward.

The checker compares version sets, not SQL contents or live schema equivalence. Historical placeholders are not evidence that their original SQL is recoverable.
