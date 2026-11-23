# DataCube AU — Native Android retrieval and evidence UX

## What the supplied mobile references inform

- A compact AU-owned floating message composer; native Compose controls and existing
  DataCube theme tokens, not another company's assets.
- The optional **AU activity** panel displays actual recorded application actions:
  source lookup, ranking, fusion and response status. It never shows hidden model
  chain-of-thought, fictional subagents, or fabricated tool steps.
- A calm Podcast audio stage: central playback, Host/Guide indicators, and a transcript
  available on demand. This is playback, not a call or a microphone stream.
- One quiet, privacy-safe notification for current document preparation. No source
  text, filenames or prompt content on the lock screen.

## Offline retrieval architecture

1. **Import:** User explicitly chooses local PDF/TXT/MD; the durable WorkManager
   extraction job stores private extracted text. The document can open as soon as
   extraction completes. The index is optional to opening, not to basic preview.
2. **Lexical indexing:** A unique, retryable offline worker builds a persistent
   per-document SQLite FTS4 passage index. It streams the full extracted source in
   bounded text buffers, preserving page markers, with ~800-character passages and
   ~120-character overlap. SHA-256 and source file stamps prevent unnecessary rebuilds.
   SQL changes commit atomically; partial builds are never published.
3. **Legacy migration:** Opening document AU Chat or Discs schedules indexing for
   unindexed old imports, with Discs limiting initial backfill to eight documents.
   Until a source is ready, a bounded preview-based BM25 search remains available.
4. **Optional neural indexing:** Only a verified, deliberately installed EmbeddingGemma
   model generates local semantic vectors in Room. No automatic download or cloud fallback.
5. **Retrieval:** Document AU Chat queries the persistent full-text index, optionally
   combines it with on-device vector matches via rank fusion, then supplies a small
   grounded evidence set to the selected AU generation runtime. Vector reads are paged
   (64 at a time) with bounded top-K selection, avoiding whole-index materialization.
   Discs retrieves indexed passages across documents and links citations to sources.
6. **Deletion:** Cancel lexical and neural workers, erase FTS passages and the source,
   redact deleted-document evidence, and clear progress/completion notifications.

## Limits and honest status

- FTS preparation is limited to 100 MiB extracted text and 60,000 passages per
  document, with a clear failure state and existing preview-search fallback.
- Retrieval ranking examines a bounded candidate set to protect low-RAM phones.
  It is not a guarantee that every passage is examined at query time.
- A **ready document** means text extraction is complete; vector indexing is
  optional and may still be pending.
- Native AU chat inference is owned by the session while the Android process
  survives navigation. Android process death can interrupt inference; WorkManager
  document indexing resumes according to OS constraints.
- Neither an AI answer nor a citation is an absolute "no hallucinations" guarantee.
  The user can expand real source excerpts for independent verification.

## Acceptance

- Compile, unit tests, lint, release preflight and Android emulator UI tests.
- On a real low-/mid-range Android device: large PDF extraction, later-chapter
  retrieval, FTS rebuild after changes, deletion during indexing, notification
  privacy and cleanup, local-model thermals/memory, Podcast audio, and chat
  continuation across workspace navigation.
