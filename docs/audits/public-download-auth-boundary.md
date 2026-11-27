# Public distribution / mobile authentication boundary

Regression introduced in PR #118: a pending mobile pairing cookie alone caused GET /, /download and other public routes to redirect to approval/login. The previous test explicitly asserted the incorrect behavior. Also the global auth-lock overlay treated public distribution pages as protected pages.

Correct the existing middleware to recover only actual OAuth result callbacks at the root or retired dashboard, never ordinary browsing. Keep the public APK download and marketing routes exempt from the client reauthentication overlay. No change to the download API, Google configuration, Android, database or pairing proof. Replace the incorrect test with public navigation and APK link verification in the presence of a stale pairing cookie and expired auth state. Preserve explicit callback recovery and approval tests.

The separate session-exchange incident is not resolved by this patch. PR #120 remains subject to its own release gate.
