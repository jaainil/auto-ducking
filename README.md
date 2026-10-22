# AudioDuck Studio

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

Files and project JSON are stored under `data/` (`DATA_DIR` overrides this). The service binds to 127.0.0.1 by default. Keep this as a local app; accounts, cloud storage and multi-user access are outside this MVP.

## Verify

```sh
npm test
npm run build
npm run verify
```

Tests exercise the shared dB envelope, region reconciliation, real Silero inference on silence and synthesized speech, native MP4/WAV/MP3 export, measured reduction, short-music looping, normalization, cancellation and failed-output cleanup. Fixtures are synthetic, generated in temporary directories and removed afterward; no user media is touched. The speech fixture uses FFmpeg's libflite filter.

Run `npm run sample` to generate optional, clearly named synthetic video and music fixtures under `output/sample/` for manual upload testing. They are not bundled into the app.

The UI verification script requires Google Chrome (`CHROME_PATH` can override its executable). It uses intercepted local static assets and checks desktop/mobile layout and upload empty states, writing screenshots to `output/verification/`. The HTTP upload, project creation, detection, and MP4 render flow has also been verified against the running backend. Sandbox restrictions prevent launching Chrome, so browser playback and responsive screenshots still require verification on a normal local machine.

`node scripts/smoke.mjs` additionally checks live Web Audio scheduling against the running Vite app: repeated settings/bypass changes, pause, seek and replay. It uses silent generated buffers and leaves user projects untouched. Browser launch remains blocked in this sandbox; the unit regression tests reproduce the reported active-curve exception with strict scheduling semantics.

Generated supporting illustration and its full prompt: `output/imagegen/PROVENANCE.md`.
