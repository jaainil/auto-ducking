# AudioDuck Studio

A source-available project by [JUHENZA](https://juhenza.com/), free for noncommercial use under the [PolyForm Noncommercial License 1.0.0](LICENSE). [Explore the source](https://github.com/jaainil/auto-ducking), or [talk to JUHENZA about custom software, SaaS and AI automation](https://juhenza.com/contact).

The license permits noncommercial purposes and the other uses specified in its terms. Commercial use requires separate permission; [contact JUHENZA](https://juhenza.com/contact) to discuss it.

Local React audio-ducking editor with Silero VAD, Web Audio playback, editable speech regions, and native FFmpeg exports. Uses the supplied Context.dev visual system with self-hosted Rethink Sans and Doto fonts.

## Run

Requires Node.js 22.18+ and FFmpeg/ffprobe on PATH.

```sh
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies media/API requests to the local Node service on port 4173. For production, run `npm run build` then `npm start`, and open http://localhost:4173.

If uploads return 404 while `/api/projects` returns HTML, the running Vite server has not loaded the proxy configuration. Stop it and restart with `npm run dev`. Run `npm run check:api` to verify both GET and upload POST routing. To check the built app directly, run `npm run check:api -- http://localhost:4173`.

Choose **Video** for video + background music (with an optional separate voiceover), or **Audio** for voice + music without a video. Audio projects take their duration from the voice track and export WAV or MP3; video projects also support MP4. Create the mix, preview, adjust settings, edit speech intervals, and export. Music fits the project duration. Ducking affects the added music; existing speech and music already mixed into a source cannot be separated.

In the editor, **Trim music** displays the full uploaded song. Drag either blue handle, use the arrow keys (Shift for one-second steps), or enter exact start/end seconds. **Match video length** sets the selection end from the current start; when there is less music available, the selection loops to fill the video. **Use full track** restores the whole song. Speed and pitch stay unchanged. The timeline waveform, live playback, seeking, autosave and all export formats use the same selection. Existing projects default to the full song. Restart `npm run dev` after updating the backend to enable saving and exporting trims.

The six creator essentials are built into the editor:

- **Undo/redo:** restore settings, music selection and speech-region edits. A continuous drag is one action. Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z or Ctrl+Y redoes. Text/number inputs retain native editing. History is session-local; restored edits autosave.
- **Music fade-in/out:** independent project-start/end music ramps in Trim music → Fades & smooth loops, from 0 to 10 seconds. They remain active in Original mode and appear in the timeline curve.
- **Smooth loops:** blend selected tail/head with an adjustable overlap, capped for short selections. Original speed and pitch stay unchanged. Preview and native export share fitting rules.
- **Audio-only projects:** voice sets project duration, no video needed, WAV/MP3 exports.
- **Solo/mute monitoring:** listen to voice, music or both. These are preview-only; exports still include both tracks.
- **Mix presets:** Gentle, Clear Speech, Strong Ducking and Long Recovery change ducking values while preserving music selection, finishing controls and speech detection preferences.

Play and Original/Ducked remain in the sticky action bar while you scroll, alongside the existing Undo/Redo and Export controls. The Tracks & timing workspace groups the project waveform, source trim, exact timing and speech regions. Mixing controls live in the side panel; less frequent timing, finishing and export processing controls expand when needed.

Restart `npm run dev` once after updating the backend, then reload your existing project; re-uploading is unnecessary.

Files and project JSON are stored under `data/` (`DATA_DIR` overrides this). The service binds to 127.0.0.1 by default. Keep this as a local app; accounts, cloud storage and multi-user access are outside this MVP.

## Verify

For automated Docker builds and VPS deployment, see [the deployment guide](deploy/README.md).

```sh
npm test
npm run build
npm run verify
```

Tests exercise the shared dB envelope, region reconciliation, real Silero inference on silence and synthesized speech, native MP4/WAV/MP3 export, measured reduction, short-music looping, normalization, cancellation and failed-output cleanup. Fixtures are synthetic, generated in temporary directories and removed afterward; no user media is touched. The speech fixture uses FFmpeg's libflite filter.

Run `npm run sample` to generate optional, clearly named synthetic video and music fixtures under `output/sample/` for manual upload testing. They are not bundled into the app.

The UI verification script requires Google Chrome (`CHROME_PATH` can override its executable). It uses intercepted local static assets and checks desktop/mobile layout and upload empty states, writing screenshots to `output/verification/`. The HTTP upload, project creation, detection, and MP4 render flow has also been verified against the running backend.

After `npm run sample`, run `node scripts/smoke.mjs` against the running Vite app. It checks real Web Audio scheduling, then creates a temporary synthetic project to exercise Original/Ducked clicks, live numeric/keyboard/drag trimming, pause/replay, saving and desktop/mobile layouts. It removes its temporary project afterward and leaves user projects untouched. This check passes in Chromium; Firefox-native verification remains outstanding. Unit regressions emulate the reported Firefox active-curve failure, including clamped cancellation. The engine avoids that cancellation dependency by scheduling each replacement curve on a fresh gain node.

The release-level browser check starts isolated native API/Vite services on ports 4199/5199 with temporary storage:

```sh
npm run sample
npm run verify -- --release
```

It verifies the six features, video and audio-only flows, WAV/MP3 downloads, MP4 rejection without video, live playback regression and desktop/mobile layouts. It cleans up test services and media afterward. Existing user projects are not modified. Chromium passes; native Firefox remains unverified. Pure/native tests also cover fades, sample-level fitting, loop seam continuity, bounded preview memory, history branching and preset preservation.

Generated supporting illustration and its full prompt: `output/imagegen/PROVENANCE.md`.

## Rust speech processing

Speech analysis automatically uses the Rust worker for clips of at least five
minutes when built. Shorter clips use Node to avoid worker startup overhead. Rust runs the same
Silero model and 32 ms frames, using the ONNX shared library already installed by
`onnxruntime-node`. FFmpeg continues to handle decoding, mixing and export.
Docker builds include the worker. For local development, install Rust using
[rustup](https://rustup.rs), then run:

```sh
npm run build:native
npm run dev
```

Restart the backend after building. Without the worker, analysis uses Node as
before. `VAD_BACKEND=node` forces Node; `VAD_BACKEND=rust` requires Rust and reports
worker errors instead of falling back. The default `auto` falls back to Node on
worker failure. `VAD_NATIVE_PATH` optionally selects a custom worker executable.

```sh
npm run bench:vad
```

The benchmark compares three runs of 60 seconds of synthetic spoken audio and
reports median detection time, including Rust process/model startup. These figures
exclude upload, decoding and export. Build the worker before running the benchmark.
`npm test` includes Rust parity checks when the binary exists, and skips those
checks on Node-only installations. Fallback tests always run.
Pass a duration to compare other clip lengths, e.g. `npm run bench:vad -- 300`.

## Smart Loudness Mastering

New exports start with mastering enabled and the YouTube preset selected. Choose
Reels, YouTube, Podcast or Advertisements in Export, or switch mastering off to
keep your mix levels with the existing peak protection. Preview plays the editable
ducked mix; mastering applies to the downloaded export.

| Recommendation | Loudness | True-peak ceiling | Suggested range |
| --- | --- | --- | --- |
| Reels | −14 LUFS | −1.5 dBTP | 7 LU |
| YouTube | −14 LUFS | −1.5 dBTP | 11 LU |
| Podcast | −16 LUFS | −1.5 dBTP | 7 LU |
| Advertisements | −16 LUFS | −2 dBTP | 5 LU |

These are creative starting points, **not official platform targets or delivery
compliance guarantees**. For advertisements, check the actual delivery brief.

The export analyzes the entire ducked mix, applies measured two-pass FFmpeg
[loudnorm](https://ffmpeg.org/ffmpeg-filters.html#loudnorm) with dynamic normalization
when needed, then measures the encoded file. It reserves peak headroom for lossy
encoding and can render once more if measured peaks exceed the recommendation.
Reports compare mix/export loudness, true peaks and range, and flag deviations or
unmeasurable audio for review. Silence is never reported as successfully normalized.
Checks allow ±1 LU loudness, 0.1 dB peak and 1 LU range tolerance; a review result
keeps the download available. Reports and preset names remain in export history
and survive a backend restart. Mastering adds analysis and verification passes,
so it takes longer than an export with mastering disabled.

`POST /api/projects/:id/export` accepts `mastering: { enabled: true, preset:
"youtube" }` (also `reels`, `podcast`, `advertisements`). Omitting both mastering and
legacy normalize options defaults to enabled YouTube; explicit legacy `normalize`
booleans remain supported.

After `npm run build`, run `npm run check:mastering` for the isolated Chrome/API
check. It generates synthetic audio in temporary storage, exercises controls,
exports, downloads, validation and restart persistence, cleans up its services and
fixtures, and saves desktop/mobile captures in `.impeccable/review/`.

## Adaptive ducking

Adaptive is the default for new mixes. Existing projects without a saved ducking
mode migrate to Adaptive at backend startup, preserving trims, regions, finishing
controls and base music levels. Choose Fixed in Mixing to use a constant speech
reduction; that explicit choice persists. The four earlier mix presets live in
Fixed mode.

Adaptive uses edited speech regions plus voice and unducked music RMS levels to
request a relative level gap, subject to minimum/maximum reduction, near-silence
gating, look-ahead, hold, attack/release smoothing, hysteresis and a gain-change
speed limit. Short speech pauses are bridged using the look-ahead, hold and release
timings, preventing music from swelling between words and immediately ducking
again. Longer pauses still fade back up; explicit zero-reduction overrides remain
intentional. Start with a 10 dB gap and 2–18 dB reduction. These are mixing
heuristics, **not LUFS targets or guarantees of speech intelligibility**. Preview
and the timeline use the actual curve. Select a speech region to replace automatic
reduction with an explicit value; overrides respect the cap and smoothing.

A dependency-free Rust core compiles to one baseline WASM module used by a browser
Web Worker and Node export. It runs on the CPU. Web Audio still applies the gain;
FFmpeg still decodes and exports. Canonical stereo RMS is measured in a bounded
stream at 48 kHz/20 ms, using the render-grade voice and the actual trimmed,
looped/crossfaded music. Only small RMS profiles reach the browser. The core
smooths 100 ms power windows and produces one 50 Hz dB curve, interpolated at
200 Hz for preview and 1 kHz for export. Base gain and music fades apply once.
Mastering, if enabled, processes the completed ducked mix afterward.

Source analysis is cached. Trim/crossfade edits need fresh levels and pause
adaptive playback until ready; gap, caps, timing and region edits recalculate in
the Worker. Failed analysis offers Retry; stale curves cannot start playback or
export. Abandoned requests cancel their FFmpeg children. At most two analysis jobs
run, with eight waiting before a retryable busy response. Spectral masking and
multiband ducking are future work; this release uses RMS + VAD.

The WASM artifact ships in `public/wasm/adaptive_ducking.wasm`; ordinary local use
does not need a Rust compiler. To rebuild it after changing the Rust core:

```sh
rustup target add wasm32-unknown-unknown
npm run build:adaptive
npm run build
```

Docker builds the WASM module from source. `npm run bench:adaptive` compares the
JavaScript reference with Rust/WASM on 30-second, five-minute and ten-minute
profiles; it measures envelope calculation including WASM copies, excluding RMS,
worker messages, decoding and export. No whole-app speedup is implied. This app's
media limit remains ten minutes.

After building, `npm run check:adaptive` runs isolated Chrome/API checks for real
WASM playback, live controls, undo/redo, region overrides, trims, export, Fixed-mode
persistence and existing-project migration. It uses temporary synthetic media and
storage, cleans its processes/files, and saves desktop/mobile evidence under
`.impeccable/review/`.
