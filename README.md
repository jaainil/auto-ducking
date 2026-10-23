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
