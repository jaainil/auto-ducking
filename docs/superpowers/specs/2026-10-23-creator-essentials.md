# Creator essentials — approved release scope

The user approved all six features recommended in the preceding discussion: undo/redo, music fade-in/out, smooth selected-section loops, audio-only projects, voice/music solo and mute auditioning, and built-in mix presets.

Preserve the existing white/blue Rethink Sans interface and existing projects. Shared settings remain the persisted source of truth. New numeric settings: musicFadeInMs=0, musicFadeOutMs=0, loopCrossfadeMs=0 (opt-in smooth loops). Bounds 0..10000 for fades and 0..2000 for crossfade; overlap is clamped to less than half the selected section. Browser and native export must use the same fitting/mixing rules. Solo/mute are temporary monitoring controls and do not affect exports; label this clearly.

Audio-only projects require voice and music, derive duration from voice, and offer WAV/MP3; MP4 must be unavailable/rejected without video. Existing video projects retain current behavior. Upload mode switching must preserve picked media where practical.

Undo/redo includes settings, music selection and speech region changes; group rapid continuous changes into one gesture and preserve the current state on undo. Keyboard shortcuts ignore editable text/number fields. History is session-local; restoring a snapshot follows existing autosave. Presets modify ducking values only and preserve music trim/fades/detection edits. Provide Gentle, Clear Speech, Strong Ducking and Long Recovery with short descriptions.

Verification must include old projects, silence and active speech, loop boundaries and seeks, fades shorter/longer than projects, audio-only exports, undo branch truncation and presets preserving selections. Keep the previous Original/trim playback regression passing. No accounts/cloud/storage migration.

Implementation fitting rule: smooth looping uses one bounded periodic cycle with period `selection length - overlap`. The first overlap seconds linearly mix the selected tail (gain 1→0) with its head (0→1); the remainder plays the selected middle. Thus the periodic buffer starts at the seam, and seeks take project time modulo the cycle period. Clamp overlap to integer sample frames strictly below half the selection (48 kHz for native export; decoded sample rate for preview). Zero overlap keeps the original selection loop behavior. Project fade-in and fade-out use linear amplitude ramps multiplied together when they overlap; they multiply the ducking gain and remain active in Original mode.
