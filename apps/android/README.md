# DataCube AU — Native Android

Native Kotlin + Jetpack Compose application. The Flutter project in `apps/mobile` remains a legacy reference and is not the active customer app.

## Implemented native slices

- Five-item application navigation: Home, Documents, Study, AU Chat and Profile.
- Compose Material 3 theme tokens and the black/white/blue visual system.
- Home dashboard with active documents, recent files and document-scoped quick ask.
- Multi-file Android Storage Access Framework import into app-private storage.
- Room-backed document metadata, collections and collection membership with versioned migrations.
- Durable Room import/extraction jobs scheduled by WorkManager; recovery is attempted at app startup.
- Streaming SHA-256 integrity verification for imported files.
- Local UTF-8 text extraction for TXT and Markdown files (up to 20 MB) with BOM/newline handling.
- Local PDF text extraction using PDFium, preserving page boundaries for citations (up to 100 MB).
- Extracted text is written atomically to app-private storage, not to Room or cloud storage.
- Document workspace with AU Chat, Smart Note, Prediction, Practice and Podcast tabs.
- AU Chat currently performs local lexical matching against extracted text and shows page references; it is not yet semantic RAG or generative AI.
- Smart Note currently builds extractive notes and a heuristic concept map from detected headings and recurring terms.
- Prediction currently builds a revision outline and prompts from detected topics; it does not provide probability scores or claim to forecast an exam.
- Practice currently provides configurable self-study prompts, answer capture and source-passage review; it does not automatically grade answers.
- Podcast currently uses Android TextToSpeech to narrate extracted passages; it does not create or upload an audio file.
- Empty, loading and extraction error states are surfaced in the relevant document tools.
- Compose UI tests cover Home, Documents, collection workspace and document study-tool interactions.

## Local-first data boundary

Imported document bytes and extracted text remain inside app-private storage. Room stores local metadata and job state. The current study helpers operate on the locally extracted preview; they do not upload source text, prompts or generated audio. Do not describe these deterministic local helpers as the production AU AI/RAG runtime.

## Target architecture

Kotlin, Jetpack Compose, MVVM, Coroutines/Flow, Room, WorkManager, Android Keystore, local-first document intelligence and provider-independent DIMR. Cloud inference should remain optional and consent-based.

## Build and verification

The GitHub Actions workflow uses JDK 21 and Android SDK 35. From this directory:

```sh
./gradlew :app:testDebugUnitTest
./gradlew :app:assembleDebug
./gradlew :app:lintDebug
./gradlew :app:connectedDebugAndroidTest
./gradlew :app:bundleRelease
```

The CI release bundle is an unsigned preflight artifact, not a Play Store-ready signed release.

## Remaining migration and product gaps

- DOCX/RTF parsing and OCR for scanned PDFs.
- Chunking, embeddings, local vector indexing and semantic retrieval.
- Production RAG chat and model gateway integration for document-aware AI.
- AI-generated Smart Notes, actual exam prediction and generated/streamable podcast audio.
- Automatic practice grading and durable study-session history.
- Complete entitlement/billing enforcement and production app configuration.
- Additional device testing across Android versions, screen sizes, accessibility settings and real hardware.

Authentication, import and local processing have native implementations, but production readiness still requires the full CI gate, real-device verification and review of backend/entitlement boundaries.
