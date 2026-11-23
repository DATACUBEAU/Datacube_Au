# Model Vault, session and document evidence UX

Implementation: PR #54, after Android PRs #47, #48, #49, #51, #52 and #53 merged into `main`.

## Model lifecycle and portability

1. **Download**: the existing verified WorkManager downloader streams verified model bytes to app-private staging. HTTP Range + ETag allow pause/resume after network loss or process restart when supported by the publisher. A single network response is read in bounded blocks; this is not a multi-part parallel downloader. Uninstall removes app-private downloads.
2. **Installed model**: weights and a `local-manifest.txt` reside at `filesDir/models/installed/<model-id>/`. On-device inference adapters expect actual file paths. Only known, compatible and publisher-verified model types become runnable.
3. **Model Vault**: Settings → Backups → Model Vault or Models → Model Vault. Android's system folder picker grants access to a **user-owned** Documents/SD-card/cloud-provider folder. This is **not** `getExternalFilesDir()` or another app-owned directory that would be erased on uninstall.
4. **Backup**: each installed, known model has its own archive. Example: `DataCubeAU-embeddinggemma-2-270m-<timestamp>.zip`. The archive has a manifest recording every model ID, relative path, length and SHA-256. It is saved first under a `.partial` filename in the selected folder, renamed to `.zip` only after the export finishes. An interrupted background export can be restarted without mistaking the incomplete archive for a good one. Archived weight files are not activated in place.
5. **Restore**: after reinstall, the user must pick the folder again; the previous URI permission does not survive uninstall. The vault lists self-describing archives, classifies known model IDs, shows a preview, then restores only after checking sizes, paths and hashes. The installer never overwrites existing model folders. A raw model file without this manifest still requires manual model selection and compatibility checks.
6. **Storage tradeoff**: portable ZIP archives are an external copy. Until native runtimes can use the user's provider URI without a file path, models must be restored into app-private storage to run, so temporary additional space is required. Backups may be stored on a cloud provider through the Android picker, but no cloud inference is involved.

## Session startup

Cold startup shows a loading indicator while encrypted Supabase session restoration completes. Successful sessions route directly to the AU Home rather than displaying Welcome. A temporary refresh failure is shown as an error without erasing the last authenticated local user; a real `NotAuthenticated` event clears the user. Private account operations still require valid server authentication.

## Document workspace

The redundant X in the top right is replaced by a three-dot menu: document details, Smart Note and Podcast. Back arrow remains the exit action. AU Chat now routes generic overview requests to available source excerpts, uses bounded typo correction against *actual document vocabulary* for keyword search, displays live retrieval-stage status, and retains a record of operations actually performed. Users can copy returned passages, open cited page snippets, and inspect highlighted matching words.

This is **observable retrieval activity**, not a model's hidden chain-of-thought, and the current pipeline remains retrieval-only until LiteRT-LM generation is integrated and validated. There is no invented answer or source.

## Background and permissions

- Model download/backup use foreground WorkManager jobs and notification channels; background execution is still subject to Android job quotas and foreground-service restrictions.
- Document extraction and vector indexing use scheduled WorkManager jobs.
- Android 13+ notification permission is requested only when the user enables task notifications in Settings.
- Text-to-speech needs no microphone access; microphone permission should be requested only when actual recording/dictation is implemented.
- No broad-storage permission is required: the user chooses their model folder with Android's Storage Access Framework.

## Release checks

- Cold start: restore an existing session offline and online; invalid/revoked session still shows sign-in.
- Back arrow vs three-dot menu; options change workspace tabs without closing it.
- Export a model to a user-selected Documents folder; confirm archive ID/manifest and hash.
- Interrupt a backup; ensure no incomplete `.zip` is offered. Rerun and restore after reinstall with folder re-selection.
- Test low-storage, access revocation, unsupported external providers, same-ID conflicts and damaged archives.
- Verify a model download resumes after a network outage; verify provider Range unsupported fallback.
- Check overview questions, common typos, copied text and source-dialog content.
- Run Android JVM tests, lint, APK, release preflight and emulator UI tests; physical-device vault and model runtime tests remain necessary.

## Remaining phases

- Runtime-verified Gemma/Qwen local generation and grounded explanation with bounded conversation history.
- Hybrid BM25/vector fusion and improved full-document retrieval context windows.
- Clickable terminology definitions grounded in source paragraphs.
- A downloadable licensed neural speech model (Kokoro/sherpa-onnx candidate) and voice picker.
- Better UX for very large model exports with byte-level progress and storage estimates.
- Optional provider-URI inference only after verifying supported file-descriptor APIs and cloud-storage behavior.
- Payment remains deferred in issue #50.
