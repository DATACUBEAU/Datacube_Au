# Verification Checklist: Duplicate User Prevention

## 1. Multi-Device Sign-in Test
- [ ] **Device A**: Sign in with Google Account X.
  - Verify `au_users` has 1 row for this user.
  - Verify `au_users.id` matches `auth.users.id`.
- [ ] **Device B**: Sign in with SAME Google Account X.
  - Verify `au_users` still has 1 row (no new row created).
  - Verify `au_users.id` matches `auth.users.id`.
  - Verify `email` is consistent.

## 2. Refresh Test
- [ ] Refresh page on Device A.
  - Verify no new row is created.
  - Verify console does not show "Consistency check failed".

## 3. Duplicate Prevention Test
- [ ] Attempt to manually insert a duplicate row into `au_users` via SQL editor:
  ```sql
  INSERT INTO au_users (email) VALUES ('existing@email.com');
  ```
  - Verify it fails with `unique constraint violation` or `null id violation` (if id not provided) or `foreign key violation` (if random id provided).

## 4. Ghost User Cleanup Test
- [ ] (Pre-migration) Insert a user with random ID into `au_users`.
- [ ] Run migration.
- [ ] Verify the ghost user is deleted.

## 5. RPC Logic Test
- [ ] Call `ensure_user_consistency()` manually in SQL editor.
  - Verify it upserts correctly without error.
