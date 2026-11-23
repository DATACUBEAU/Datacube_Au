# Offline Neural Narration — DataCube AU

The optional Kokoro-82M model is available under Models → Voice.
It is **never** downloaded on launch or automatically. The user chooses a
Documents / SD-card folder and explicitly starts the download. Completed
downloads are SHA-verified and archived by model ID to the external Model
Vault before being reported as successful.

## Implementation

- Model: litert-community/Kokoro-82M, kokoro_int8_fp16.litertlm, pinned
  revision 81e43a025bccabcbbd487f08bc3ebd65b5fc7295; SHA-256
  e7b931ee5d4b7104012a838c9eee240d19ea69cb3ca269041a3274f83dbb7fa1;
  Apache-2.0, ~295 MB.
- SDK: MediaPipe Tasks Audio 1.2.3, native TextToSpeech (LiteRT-LM Omni),
  no cloud transcription, voice cloning, microphone or background automatic
  recording. CPU model selected to preserve emulator and non-GPU-device
  compatibility.
- Playback: Podcast page → choose Android offline or Kokoro neural voice →
  select voice → explicit Play/Preview. Samples are native float32 PCM
  played through AudioTrack. Stop cancels native synthesis and playback.
- Four curated voices avoid flooding the interface: Heart (US), Bella
  (US), Adam (US), George (UK). Voice preference is saved on-device.
- Audio and text remain on the user's device; file hashes are verified
  before launching the runtime, including after manual import/restore.
- Android TTS remains available when Kokoro is absent or unsupported.
  No other model is downloaded automatically.

## Acceptance tests needed

1. On a real arm64 device with 4+ GB available memory, download the Kokoro
   file to the externally selected Model Vault and verify retained model-ID
   ZIP survives app uninstall and folder re-selection.
2. Play preview in four voices; confirm natural narration, stop and resume.
3. Play a 1–2-minute chapter and switch voices without audio glitches.
4. Verify that on low memory, an unsupported ABI, or native inference
   failure, the app displays an error rather than silently synthesizing
   with the wrong engine.
5. Inspect APK/native dependencies for 16-KB memory-page alignment and
   runtime symbol conflicts. Test battery/thermal response on phones.

This is an opt-in on-device speech-synthesis engine. Speech-to-text, a
hands-free conversational voice assistant and phone-hardware performance
certification are separate work.
