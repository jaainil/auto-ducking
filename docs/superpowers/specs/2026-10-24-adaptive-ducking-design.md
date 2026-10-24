# Adaptive RMS ducking

User requests RMS + VAD adaptive ducking with shared preview/export automation;
User subsequently explicitly requested a shared Rust WASM core in a Web Worker, with benchmarks rather than speed promises. User first chose adaptive for new mixes, then
explicitly requested existing projects switch to adaptive too. Existing trims,
regions, base levels and fades remain; a user can choose Fixed mode afterward.

Extend the existing Operate Mixing panel in its incumbent white/blue/Rethink world.
Show Fixed/Adaptive controls, target gap, max reduction, optional minimum in an
advanced disclosure, and concise heuristic copy. Timeline renders the actual
adaptive curve. Selected regions allow automatic or explicit reduction overrides.
Reuse undo/redo, autosave, timing and comparison. No invented intelligibility or
frequency-masking guarantees. This implements guide stages 1–2; spectral experiments
remain later work and no frequency-aware control is claimed.

Stream canonical 48 kHz stereo float audio through FFmpeg to measure source RMS at
20 ms hops, before music gain/ducking. Music preparation reuses exact native trim,
loop and crossfade rules. Voice uses render-grade WAV, avoiding lossy-preview-derived
measurements. Only short RMS arrays reach the browser; cache completed profiles.
Recompute music levels after trim/crossfade changes; show pending/error states and
pause adaptive playback until matching levels are ready. Editing gap, caps, regions
or base gain then recalculates shared JS automation immediately with no inference.

Core: smooth 100 ms power windows, gate by edited merged speech and voice >−55 dBFS,
clamp M+B−V+G to 2..18 dB by default; target gap10dB. Anticipate speech with lookahead,
hold200ms, attack50ms/release500ms time constants, hysteresis1dB and maxslew36dB/s.
Outputs relative gain; base/fades apply once in existingplayer/nativeexport. Build
one canonical50Hz dBcurve and interpolate it at preview200Hz/export1000Hz so timing
and values agree. No output-level feedback. Region overrides respect maximum cap.

Legacy settings without a mode migrate to adaptive at load, with prior musical
choices preserved. Explicit Fixed selections survive reload. Newproject timing and
levels follow adaptive defaults. Renderer fetches the same canonical profiles.
Tests cover equations, stereoenergy, trim/loops, silence, overrides, smoothing,
settings validation, stale requests, migration, browser playback and native parity.
The dependency-free Rust core compiles to one baseline WASM artifact, loaded once
by a browser Worker and Node. Shared JS remains the tested reference; production
adaptive calculation uses Rust. Preserve the separate existing Rust VAD worker.

## Direction contract

- World: extend the incumbent white/blue, Rethink Sans editor; no new visual identity.
- First viewport: retain preview/timeline hierarchy and existing sticky transport;
  the Mixing sidebar introduces Adaptive/Fixed mode and useful adaptive controls.
- Composition: native segmented buttons, compact gap/cap sliders, advanced tuning
  disclosure; measured curve stays on the existing timeline, region override in
  the selected-region workspace. No separate dashboard or promotional treatment.
- Signature interaction: gap/region changes recompute the actual Rust curve in a
  Worker; the same automation reaches playback and FFmpeg, with undo and bypass.
- State/motion: no decorative animation; show source measurement, curve update,
  retryable errors and ready state; pause on invalid source profiles. Sidebar
  scrolls on desktop and stacks on mobile, with labels and keyboard controls.

Quality bar: inherited editor form-control quality, readable narrow sidebar/mobile,
truthful RMS heuristic copy, explicit Fixed fallback choice, no frequency-aware or
universal intelligibility claim, bounded resources and deterministic automation.
