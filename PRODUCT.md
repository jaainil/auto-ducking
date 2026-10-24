# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated: React 19 + TypeScript + Vite for the editor, a plain Node.js HTTP API for projects/uploads/render jobs, a shared Rust/WASM adaptive core running in a browser Web Worker and Node, native FFmpeg + ffprobe for media work, and local JSON/file storage under `data/`. Chosen for a single-machine MVP: no Redis, PostgreSQL, authentication, or object storage yet.

## Users

Creators producing Instagram Reels, YouTube videos, podcasts, course lessons, and marketing videos who have a voiceover or dialogue track plus background music. They are time-pressed, work with their own media files, and want the music to sit under speech without drawing volume automation by hand. They are comfortable uploading video and audio, but are not necessarily audio engineers.

## Product Purpose

AudioDuck Studio lets a creator upload a video and a music track, optionally a separate voiceover, detect exactly where speech happens, generate an editable music-volume automation curve, preview the ducking live in the browser, and export a finished MP4 or audio file. Success means a professional-sounding mix on the first pass, with preview and export sharing the same ducking envelope and optional export-only mastering, without learning a full video editor.

## Positioning

Speech-aware dB automation is the source of truth. Adaptive ducking combines edited speech regions with voice and unducked music RMS levels to request a relative level gap within reduction limits. Fixed mode applies a constant speech reduction. Preview, timeline and export share the calculated envelope, so users tune a visible, predictable curve; manual speech regions remain editable. RMS-based adaptation is a mixing heuristic, not a LUFS target or a guarantee of speech intelligibility.

## Operating Context

Local-first for the MVP: uploaded media, extracted audio, projects, and renders live on the user's machine. Sources range from 20–60 second vertical reels to longer landscape YouTube videos. The primary workflow is video + music; a separate voiceover is optional when the video's own audio is not the speech source. If a video already contains speech and music mixed together, only newly added music can be ducked; the app must state this limitation rather than imply source separation.

## Capabilities and Constraints

- Choose video + music with optional voiceover, or an audio-only voice + music project. Audio-only duration comes from the voice track and supports WAV/MP3; video projects also support MP4.
- Probe media with ffprobe; reject unsupported files and enforce a 250 MB per-file / 10 minute duration limit.
- Detect speech with Silero VAD through ONNX Runtime when the model is present, with a built-in energy/spectral detector as the offline fallback.
- Store VAD frame probabilities so sensitivity and pause-merging can be re-evaluated without re-analyzing the file.
- Adaptive is the default for new mixes: 10 dB relative gap, 2–18 dB reduction, −8 dB base music, 100 ms look-ahead, 50 ms attack, 200 ms hold and 500 ms release. Minimum reduction, hysteresis and gain-change speed are advanced controls alongside the existing timing controls. Near-silence gating and smoothing keep adaptation bounded.
- Existing projects without a saved mode migrate to Adaptive at backend startup while preserving previous musical settings and speech regions. Explicit Fixed choices persist; Fixed retains constant-reduction automation.
- Analyze the render-grade voice and fitted, trimmed, looped/crossfaded unducked music through bounded 48 kHz stereo streams with 20 ms RMS frames. Only small profiles reach the browser; the Rust/WASM core smooths 100 ms power windows and calculates the curve off the main thread. This release uses RMS + VAD; spectral masking and multiband ducking remain future work.
- Edit speech regions directly on the timeline: move, resize, add, delete, enable/disable, and reset to detection.
- Override automatic reduction per speech region, subject to the maximum cap and smoothing. The timeline displays the actual calculated curve, with seeking, bypass and undo/redo supported.
- Live Web Audio preview synchronized to the video, with a ducked/bypassed before-after comparison.
- Trim the uploaded music using waveform handles or exact seconds. The selected source section loops/cuts to video duration at original speed and pitch, with consistent preview, seeking, timeline waveform, saved settings and native export. Existing projects use the full track by default.
- Render MP4 (H.264 copy when compatible, transcode fallback; AAC 192 kbps), WAV, and MP3 through native FFmpeg, with progress, cancellation, output verification, and cleanup.
- Independent music fade-in/out and opt-in smooth looping with the same sample-fitting rules in preview/export.
- Session-local grouped undo/redo for settings, selection and speech edits; restored snapshots autosave.
- Voice/music solo and mute auditioning (preview only).
- Four built-in ducking presets are available in Fixed mode and preserve music selection, finishing and detection settings.
- Preview and export use the same Rust/WASM curve, interpolated at 200 Hz and 1 kHz respectively; base gain and music fades apply once, with optional mastering afterward.
- Trim/crossfade changes pause Adaptive playback until fresh levels are ready. Failed analysis offers Retry; stale curves cannot start playback or export. Abandoned requests cancel their FFmpeg processes; analysis is limited to two running jobs and eight queued requests.
- Smart Loudness Mastering is export-only, enabled by default with YouTube selected; Reels, YouTube, Podcast and Advertisements presets recommend loudness, dynamics and true-peak settings, not official platform targets or delivery compliance. Users can disable mastering to keep mix levels with peak protection. Browser preview plays the editable ducked mix.
- Mastering analyzes the exact full ducked mix, applies measured two-pass FFmpeg loudnorm with dynamic normalization when needed, then measures the final encoded file. It reserves peak headroom and allows one additional render if encoded peaks exceed the recommendation.
- Before/after loudness, true-peak and range measurements, preset names and quality reports persist with exports and jobs across backend restarts. Deviations and unmeasurable results require review rather than a false pass; downloads remain available for review results.
- Not in this version: cloud storage, accounts, collaboration, saved presets, batch processing, public API, multiple music beds, AI source separation, or speech-to-text.

## Brand Commitments

The product name is **AudioDuck Studio**. The visual identity is pinned by the supplied "Context.dev Minimal SaaS" design system: bright white surfaces, electric blue `#2563EB`, black and graphite type, Rethink Sans for UI and display, Doto only for measured/timecode detail, pill controls, hairline borders, soft 8px cards, generous spacing, and faint dotted motifs at the edges. Voice: confident, plain, precise; no hype, no faux-engineer jargon.

## Evidence on Hand

No customers, testimonials, benchmarks, press, or production media exist. Any demonstration media created during development is synthetic and must not be presented as a real customer project or shipped as a bundled demo. The app must open on an empty upload state.

## Product Principles

1. The automation curve is the single source of truth; preview and export must render the same envelope.
2. Protect speech first, but keep the music present and musical rather than slamming it to silence.
3. Users should edit exceptions, not every region; automatic results must be good enough to leave alone.
4. Local-first trust: the user's media stays on their machine in this version, and the interface says so plainly.
5. Calm, precise craft: the timeline is the product, and every control must earn its place beside it.

## Accessibility & Inclusion

Target WCAG 2.2 AA: body and control text at 4.5:1 or better, visible keyboard focus, full keyboard operation of transport and controls, timeline regions exposed as an editable list as well as canvas, reduced-motion support, and no color-only state signals.
