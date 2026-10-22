# AudioDuck Studio design system

Preserve the supplied Context.dev Minimal SaaS identity. White surfaces, blue #2563EB, black headings, graphite supporting text, and #E6E6E6 hairlines. Rethink Sans is self-hosted for UI; Doto is reserved for measurements. Display type is 56px with tight tracking; controls are compact pills. Cards use modest corners and restrained depth.

The home surface helps creators start a mix: centered headline, video and music uploads, optional voiceover, one primary action. Faint edge-bound dots support the composition. The editor is a task surface: video preview, synchronized transport, editable timeline, ducking settings, then export. Maintain keyboard focus, reduced motion, validation, loading and disabled states, and mobile stacking.

The waveform and automation are code-rendered data, never raster imagery. The supporting headphones still life is generated illustration, labeled as such; it is neither customer proof nor sample media. Provenance and prompt are recorded in output/imagegen/PROVENANCE.md.

Music trimming extends the editor between video preview and the ducking timeline. Show the full source waveform with subdued excluded audio, a blue selection and two draggable keyboard-operable handles. Exact second fields provide an alternative to dragging. A compact summary explains how the selection loops/cuts to fill the video without changing speed or pitch. Keep source-song time distinct from project time: this waveform selects source audio; the main timeline shows its fitted result. Controls stack on narrow screens. Resetting ducking does not reset music selection.

Verification: production compilation and native pipeline tests pass; desktop/mobile browser inspection is pending because this environment blocks Chrome socket initialization. Run npm run verify outside this sandbox.
