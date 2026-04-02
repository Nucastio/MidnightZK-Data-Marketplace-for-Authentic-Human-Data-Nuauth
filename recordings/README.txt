NuAuth sandbox — Asciinema recordings
=====================================

Sandbox walkthrough (fixture playback: same tx hashes as the successful Preview E2E, no network):

  recordings/nuauth-preview-replay.cast

MP4 (rendered from the cast via asciinema/agg + ffmpeg):

  recordings/nuauth-preview-replay.mp4

Re-render MP4 from the cast:

  bash scripts/render-asciicast-to-mp4.sh

Play locally:

  asciinema play recordings/nuauth-preview-replay.cast

Re-record (default pacing mirrors sync / ZK waits; quick pass: NUAUTH_DEMO_FAST=1):

  bash scripts/record-nuauth-preview-asciinema.sh recordings/my-replay.cast

Upload for sharing:

  asciinema upload recordings/nuauth-preview-replay.cast

Convert to video (on a machine with the Rust “agg” renderer or a screen recorder):

  - Install https://github.com/asciinema/agg then render the .cast to MP4/WebM, or
  - Fullscreen terminal, run `asciinema play …` and capture with OBS / QuickTime.

Canonical data for the walkthrough lives in:

  fixtures/nuauth-preview-e2e-replay.json
