# Smart mastering implementation plan

Goal: export an automatically mastered mix with useful measured checks.
Spec: ../specs/2026-10-24-smart-mastering-design.md
Architecture: shared preset definitions; native measurement/filter/report helpers;
existing renderer and queue persist the report; React extends its export panel.

- [x] Write failing native renderer tests for mastered output, disabled path,
  silence, preset rejection, measured loudness/peaks, cancellation and cleanup.
- [x] Implement/test shared mastering definitions and FFmpeg report helpers.
- [x] Integrate analysis, measured second pass, encoded-output verification and
  bounded peak retry into rendering; propagate cancellation to all passes.
- [x] Validate API input; persist preset and report in jobs/history.
- [x] Add enabled-by-default YouTube controls and an accessible quality report;
  preserve existing editor composition and responsive behavior.
- [x] Run complete native tests/build; inspect desktop/mobile together; run detector
  once, resolve mechanical findings, obtain finish review and document outcome.

Review focus: lossy codec overshoot; nonfinite silence measurements; source changes
between passes; legacy normalize callers; queue restart/report persistence; no
preview mastering claim; ambiguous platform target language.

## Verification and review record

- npm test: 57 passed, 0 failed, 0 skipped (including native Rust regressions).
- npm run build: passed.
- node scripts/check-mastering.mjs: passed against isolated native API + Chromium;
  covered default YouTube, all four preset controls, disable, real export and
  measured report, download, invalid preset 422, default API options, report
  persistence after backend restart and reload, desktop/mobile overflow checks.
- Detector ran once on changed web targets and returned [].
- First mobile inspection exposed intrinsic-width sidebar expansion on long
  filenames; fixed panel min-width and confirmed at 390 px.
- Independent backend review caught callback exceptions escaping subprocess event
  handlers. Real FFmpeg regressions watched fail, then pass after wrapper fix;
  cancellation tests cover both analysis and encoded-file verification progress.
- Finish reviewer: all changed visual elements match incumbent direction; requested
  correction to old PRODUCT.md single-pass/preview-equivalence descriptions.
  Documenter handles only authorized product truth updates, preserving DESIGN.md.
- No generated media shipped; test fixtures and isolated backend storage cleaned.

- Final finish verdict: ship; the reviewer scored the PRODUCT.md truth correction resolved. Previously reviewed UI unchanged.
