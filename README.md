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

Upload a video and background music; optionally add a separate voiceover. Create the mix, preview the result, adjust reduction/fades/sensitivity, edit speech intervals, and export MP4, WAV, or MP3. Music loops to fit the video. The existing mixed audio in a video cannot be separated; ducking affects only the added music. This MVP currently requires a video, including for audio-only exports.

In the editor, **Trim music** displays the full uploaded song. Drag either blue handle, use the arrow keys (Shift for one-second steps), or enter exact start/end seconds. **Match video length** sets the selection end from the current start; when there is less music available, the selection loops to fill the video. **Use full track** restores the whole song. Speed and pitch stay unchanged. The timeline waveform, live playback, seeking, autosave and all export formats use the same selection. Existing projects default to the full song. Restart `npm run dev` after updating the backend to enable saving and exporting trims.

Files and project JSON are stored under `data/` (`DATA_DIR` overrides this). The service binds to 127.0.0.1 by default. Keep this as a local app; accounts, cloud storage and multi-user access are outside this MVP.

## Verify

```sh
npm test
npm run build
npm run verify
```

Tests exercise the shared dB envelope, region reconciliation, real Silero inference on silence and synthesized speech, native MP4/WAV/MP3 export, measured reduction, short-music looping, normalization, cancellation and failed-output cleanup. Fixtures are synthetic, generated in temporary directories and removed afterward; no user media is touched. The speech fixture uses FFmpeg's libflite filter.

Run `npm run sample` to generate optional, clearly named synthetic video and music fixtures under `output/sample/` for manual upload testing. They are not bundled into the app.

The UI verification script requires Google Chrome (`CHROME_PATH` can override its executable). It uses intercepted local static assets and checks desktop/mobile layout and upload empty states, writing screenshots to `output/verification/`. The HTTP upload, project creation, detection, and MP4 render flow has also been verified against the running backend.

After `npm run sample`, run `node scripts/smoke.mjs` against the running Vite app. It checks real Web Audio scheduling, then creates a temporary synthetic project to exercise Original/Ducked clicks, live numeric/keyboard/drag trimming, pause/replay, saving and desktop/mobile layouts. It removes its temporary project afterward and leaves user projects untouched. This check passes in Chromium; Firefox-native verification remains outstanding. Unit regressions emulate the reported Firefox active-curve failure, including clamped cancellation. The engine avoids that cancellation dependency by scheduling each replacement curve on a fresh gain node.

Generated supporting illustration and its full prompt: `output/imagegen/PROVENANCE.md`.
