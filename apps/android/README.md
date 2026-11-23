# DataCube AU — Native Android

Active client: Kotlin, Jetpack Compose, Coroutines, Room, WorkManager and native on-device AI adapters in `apps/android`. The Flutter directory is legacy reference material. The web app handles browser sign-in/approval and checkout, not local document inference.

## Workspace and local documents

- Home and Documents share a compact floating AU / Document selector; document study tools are nested in each document workspace.
- Google sign-in uses explicit browser approval/pairing and encrypted Android session recovery. Session restore avoids flashing the unauthenticated screen.
- The Android document picker imports multiple PDF, TXT and Markdown files into private app storage. Room tracks document metadata, collections and work state.
- WorkManager extracts local text; PDFium keeps page boundaries for source citations. Existing limits are 100 MB PDF and 20 MB text/Markdown.
- The workspace has AU Chat, Smart Note, Prediction, Practice and Podcast tabs. Smart Notes include an interactive source-linked concept map; prediction is a heuristic revision outline, not an actual exam forecast; practice is self-review, not automated grading.
- Per-document AU Chat turns and source references persist across ordinary app restarts in app-private files. They do not survive uninstall without a separate backup.

## Real local AU Chat / retrieval

- Document search begins with source-page-aware text chunking and BM25. If a verified compatible EmbeddingGemma 2 270M model is installed on Android 9+, a background Room vector index adds on-device semantic retrieval.
- The BM25 and semantic passage results are fused for citations. Retrieval remains usable when a model is missing or fails.
- Android LiteRT-LM uses one explicitly selected, publisher-checksum-verified local Qwen3 0.6B or Gemma 4 E2B/E4B model for source-grounded streaming AU Chat answers. Models are **not included in the APK** and are never downloaded automatically.
- Generation quality, exact runtime support, RAM use and citation faithfulness need real-phone benchmarking. Retrieved evidence remains available on model failure; model output is not guaranteed factual.
- Tapping words in a generated response opens real source text when a matching passage exists. The optional explanation uses the installed local model; the app must never fabricate source definitions.

## Small, explicit model setup and portable storage

- First-login device assessment is optional and checks RAM and available storage. It recommends one search model plus one chat model; advanced alternatives are collapsed.
- The user must choose an external folder via Android Storage Access Framework before using a verified model download.
- Download controls explicitly ask for Wi-Fi only or mobile-data consent. A WorkManager worker streams into app-private temporary storage with resume, progress, cancellation, an immutable publisher revision and SHA-256 verification.
- A completed download installs a private runtime copy and writes a named, checksum-manifested per-model ZIP into the user-selected `DataCubeAU-Models/<model-id>/` hierarchy. Staging and incomplete downloads remain private and **do not survive uninstall**.
- External completed archives can survive uninstall, but the user must reselect the folder and restore models into app-private storage after reinstalling. Android SAF authorization is not retained across uninstall.
- Importing arbitrary publisher files checks local file integrity but does not establish publisher authenticity. Only reviewed verified model artifacts are permitted to activate supported runtime adapters.
- The external archive and installed model generally consume storage for two copies. Never describe portable backup as zero-copy model inference.

## Speech and podcasts

- Podcast supports installed offline Android TTS voices and, optionally, the user-downloaded verified Kokoro-82M neural pack. The Kokoro option uses local PCM synthesis with curated voice choices and explicit Preview/Play/Stop controls; it is not voice cloning or speech recognition.
- AU Chat can optionally dictate an editable question using Android's on-device speech recognizer on Android 12+ **only when the device reports a local recognition service**. The microphone is activated only after tapping the mic and granting permission; Stop cancels recognition. Text must still be manually sent. This path never falls back to an online recognizer and never triggers a model download.
- If the phone has no offline recognition service, typed chat remains available. No always-listening assistant or hands-free voice conversation is implemented.

## Local/cloud boundary and known gaps

Private imported documents, extracted text, local embeddings, model-generated answers and narration remain on the device in these workflows. Supabase remains the authentication, administration and potential billing control plane; this Android work does **not** prove billing/entitlement enforcement.

Outstanding product or release tasks:
- Real-device acceptance of Gemma/Qwen, EmbeddingGemma and Kokoro, including RAM, thermal pressure, cancellation, backgrounding and actual download/restore over multiple storage providers.
- DOCX/RTF extraction, OCR for scanned PDFs and large-document streaming improvements.
- Automated practice assessment, fuller study history and advanced generated visuals. Smart Note diagrams are document-derived interactive concept maps, not photorealistic graphics.
- Android and backend billing/entitlement integration, real subscription flows and a signed store-ready release.
- Accessibility, low-RAM, offline language availability and device-matrix tests.

## Verification

The GitHub Native Android CI builds the debug APK, runs JVM tests, compiles instrumentation tests, runs Android lint and API-35 emulator UI tests, and builds an **unsigned** release bundle. CI success is not proof of performance or speech quality on a physical phone.

From `apps/android` with Android SDK and JDK 21 available:

```sh
./gradlew :app:testDebugUnitTest
./gradlew :app:assembleDebug
./gradlew :app:lintDebug
./gradlew :app:connectedDebugAndroidTest
./gradlew :app:bundleRelease
```

For deeper implementation notes see `docs/android-local-rag-neural-voice-implementation.md`, `docs/android-model-vault-and-evidence-ux.md` and `docs/android-kokoro-neural-narration.md`.
