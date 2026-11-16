# DataCube AU — Flutter foundation (P0)

This is the native Android-first customer application. The Next.js public website and Conex Admin Portal remain in place.

## Implemented scaffold
- Flutter app entry, Material 3 blue/white/navy theme and initial app shell.
- Riverpod root scope and go_router foundation.
- SharedPreferences for lightweight UI preferences only.
- Drift-backed SQLite local database using WAL, foreign keys, schema versioning and a durable local job table.
- WorkManager callback and one-off/periodic scheduling wrappers.
- Local notification service and Android notification permission request.

## Background-work contract
1. Persist a job in SQLite before scheduling WorkManager.
2. A worker reloads the job by ID; never depend on memory, providers or a live screen.
3. Jobs must be idempotent, checkpoint progress and record attempts/errors.
4. User-visible long work needs progress. Continuous work may need a foreground service with a persistent notification, subject to Android policy.
5. WorkManager is deferrable, not an exact timer. Doze, battery saver, quotas, force-stop and OEM policies can delay or stop work.
6. Cancellation is cooperative: persist cancellation and cancel unique work.
7. Notifications are status surfaces; SQLite remains the source of truth.

## State preservation
- Keep feature data and processing checkpoints in app-private storage.
- Keep document bytes, OCR, chunks, embeddings, indexes and chat history out of preferences and notification text.
- On restart, reconcile queued/running jobs with WorkManager and resume from durable checkpoints.
- Android may terminate the process at any time. Do not promise a Dart isolate or transient UI state survives shutdown.

## Performance rules
- Run parsing, OCR, embeddings and model work off the UI isolate.
- Bound concurrency based on device capability and memory.
- Batch database writes; stream progress; avoid unnecessary widget rebuilds.
- Defer expensive work when battery is low or the device is thermally constrained.
- Benchmark cold start, frame jank, import throughput, memory and battery before tuning.

## Verification still required
- Generate Android platform files/Gradle wrapper with Flutter tooling.
- Verify plugin compatibility and Android manifest/Gradle configuration.
- Add integration coverage for transactional job claiming, checkpoint/retry/cancel and restart reconciliation.
- Register real ingestion executor; implement foreground execution where justified.
- Add process-death/reboot, lifecycle, scheduler and notification tests.
- Run flutter pub get, dart format, flutter analyze, flutter test, flutter build apk --debug and a real-device smoke test.

This is a scaffold, not a build-verified or release-ready application.
