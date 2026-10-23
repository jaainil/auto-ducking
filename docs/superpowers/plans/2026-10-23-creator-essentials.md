# Creator Essentials Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the six approved creator editing essentials with consistent preview/export behavior.
**Architecture:** Extend the existing project settings and local API; share music-fitting math between native rendering and Web Audio. Editor snapshots provide history; audition state stays out of exports.
**Tech Stack:** React/TypeScript, Web Audio, Node.js, native FFmpeg, node:test, Playwright.
**Spec:** docs/superpowers/specs/2026-10-23-creator-essentials.md

## Global Constraints
- Preserve existing projects and white/blue visual system; no new runtime dependencies.
- Do not modify user media or existing projects during verification.
- Preview/export timing, fades and loop fitting must agree.
- All six approved features ship together; no cloud/account work.

## Review Focus
- Very short music selections: clamp overlap and avoid infinite processing.
- Long recordings: avoid unbounded browser memory for crossfaded music.
- Audio-only project creation: no null-video assumptions in routes or editor.
- Continuous edits: undo one gesture and preserve a redo branch until a new edit.
- Live Original/trim/solo changes: never edit active AudioParam curves or restart dialogue unnecessarily.

## Tasks
- [x] Audio engine: failing tests for fades/crossfades and monitor modes; implement shared fitting plus native rendering; retain existing regressions.
- [x] Audio-only: tests/validation for optional video and required voice; extend uploads/projects/types and reject MP4 for audio-only output.
- [x] History/presets: pure snapshot history with branch truncation/grouping and four non-destructive ducking presets; test both.
- [x] Editor integration: undo/redo controls and shortcuts, music finish controls, monitor controls and preset selector; audio-only preview and export states.
- [x] Verification: unit/native tests, production build, real browser video+audio creation, all controls, native export, desktop/mobile capture; bounded review and fixes.
- [x] Documentation: update product/design/README with behavior and verification limits.

## Completion evidence

- npm test: 37 passed, 0 failed.
- npm run build: TypeScript and Vite production build passed.
- npm run verify -- --release: real Chromium Web Audio, live editor controls, preset undo/redo, monitoring, audio-only upload/create/playback/WAV+MP3 downloads and MP4 rejection passed. Isolated API/Vite test services and temporary media were removed.
- Desktop/mobile captures reviewed; deterministic design scan returned no findings.
- Cross-feature review found no blocking issues. Native Firefox remains unverified.
- Follow-up safeguards: clamped smooth-loop preview allocation to the project duration; range-focused undo works; keyboard button actions and inspector blur commits receive independent history groups.
