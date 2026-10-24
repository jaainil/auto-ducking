# Adaptive ducking plan

Spec: ../specs/2026-10-24-adaptive-ducking-design.md

- [x] Implement and test shared adaptive DSP against handworked values, gating,
  smoothing, slope, overrides and rate parity.
- [x] Factor native music fitting and stream canonical stereo RMS with bounded
  memory/caching, testing native source measurements.
- [x] Add settings/migration, analysis endpoint, render integration and override
  persistence without changing explicitly selected Fixed mode.
- [x] Extend Mixing and region controls; gate adaptive playback/export on fresh
  profiles; keep timing/undo/trim/seek and actual timeline curve intact.
- [x] Test end-to-end persistence, manual controls and measured export behavior.
- [x] Benchmark JS path; add Rust only if it offers worthwhile measured benefit.
- [x] Run full suite/build; bounded desktop/mobile review/detector; independent code
  and finish reviews; document new product truth without visual-system refresh.

Review focus: stale profiles after edits, stereo cancellation, double base gain,
legacy project migration, near-silent false speech, region override caps, cancel
cleanup, gain resampling parity, invalid settings and long-media resource bounds.

## Verification and decisions

- Ruling: user explicitly requested Rust/WASM core after initial JS-first proposal.
  One dependency-free Rust module now runs in a browser Worker and Node export;
  JS remains the test/benchmark reference. No speedup assumption or GPU added.
- User also explicitly requested existing-project migration. Startup migrates
  projects without a saved mode, preserving musical edits; explicit Fixed persists.
- npm test: 81 passed, 0 failed, 0 skipped, including reference/WASM parity,
  stereo PCM, bounded queue/cancellation, settings migration and measured native
  adaptive export plus prior mastering/Rust VAD regressions.
- Rust core cargo test: 3 passed. Native WASM release and app production build pass.
- Chrome/API adaptive check passed actual Worker, defaults, gap changes, undo/redo,
  overrides, trim analysis, playback/bypass, WAV export, Fixed reload and legacy
  migration. Additional API-boundary regression observed 24 vs requested30dB;
  corrected schema to preserve UI minimum up to36dB and confirmed functional pass.
- Detector ran once on changed targets: []. Two bounded desktop/mobile inspection
  rounds; corrected override inset and slider-group spacing, confirmed no overflow.
- Independent code review found abandoned analysis continued consuming FFmpeg.
  Response disconnect now cancels children; queue allows2active/8pending, with
  queued cancellation. Reviewer scored finding resolved.
- Finish review disposition ship: all changed visual elements match incumbent
  world; all4required captures valid; no material fixes. Documenter updated only
  PRODUCT.md and preserved DESIGN.md/preexisting sidecar drift.
- Local warmed Node benchmark (9run medians, includes WASM copies): 30sec JS0.734ms
  /Rust0.383ms;300sec JS2.674/Rust2.530;600sec JS5.591/Rust5.284. WASM initialization
  1.387ms. These exclude RMS/decode/network/Worker messaging/export and are not
  device-wide or whole-app performance claims. Ten-minute media cap unchanged.
- Docker configuration builds WASM fromsource; Docker executable unavailable here,
  so the actual container build remains unverified. Linux native/WASM/app builds
  and actual isolated API/browser behavior are verified.
