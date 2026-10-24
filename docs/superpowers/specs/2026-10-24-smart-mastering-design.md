# Smart Loudness Mastering

Extend the existing Operate editor export surface, preserving its white/blue
Context.dev identity, Rethink Sans, hairlines and native controls. User confirmed
mastering enabled by default with YouTube selected. Show a checkbox, preset select,
three compact target measurements, honest recommendation copy, and export-only
explanation. Completed exports show measured before/after loudness, range and true
peak with individual quality checks. Preserve download access on review warnings.
No official platform-target or compliance claims.

Use shared authored recommendations: Reels -14 LUFS/-1.5 dBTP/7 LU range; YouTube
-14/-1.5/11; podcasts -16/-1.5/7; online advertisements -16/-2/5. Ads copy reminds
users to check their delivery brief. Two-pass FFmpeg loudnorm uses the same final
mix graph for analysis and processing, retaining natural dynamics when linear
normalization suffices and using dynamic normalization when required. Reserve
0.5 dB for lossy codec overshoot, then measure the encoded output. If peaks exceed
the preset, retry once with additional headroom. Report remaining mismatch rather
than claiming compliance. Silence/too-short measurements are nullable and flagged.

Carry preset/report through API, job persistence, project export history and reload.
Validate presets before queueing. Explicit legacy normalize booleans remain
supported; new API exports default to enabled YouTube. Disabling mastering preserves
existing mix/limiter behavior. Preview remains the editable ducked mix; mastering
applies to exports. All passes support cancellation and temporary/output cleanup.

Alternatives: single-pass normalization cannot use measured program statistics;
client-only analysis misses encoding overshoots. Selected two-pass native path plus
encoded-file verification fulfills the requested delivery checks.
