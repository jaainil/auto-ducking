import { performance } from 'node:perf_hooks';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadVoiceDetector, detectSpeech } from '../server/vad.mjs';
import { runFfmpeg, decodePcm16k } from '../server/media.mjs';

const dir = await mkdtemp(join(tmpdir(), 'audioduck-bench-'));
const detectors = [];
try {
  const audioSeconds = Number(process.argv[2] ?? 60);
  if (!Number.isFinite(audioSeconds) || audioSeconds <= 0 || audioSeconds > 600) throw new Error('Choose an audio duration greater than 0 and at most 600 seconds.');
  const file = join(dir, 'speech.wav');
  await runFfmpeg(['-f','lavfi','-i','flite=text=Welcome to Audio Duck Studio. Your voice stays clear while the music fades naturally.:voice=slt','-ar','16000',file]);
  const source = await decodePcm16k(file);
  const samples = new Float32Array(Math.round(audioSeconds * 16000));
  for (let i = 0; i < samples.length; i++) samples[i] = source[i % source.length];
  const results = {};
  for (const backend of ['node', 'rust']) {
    const detector = await loadVoiceDetector(new URL('../server/models/silero_vad.onnx', import.meta.url).pathname, { backend });
    detectors.push(detector);
    await detectSpeech(samples.subarray(0, 16000), detector);
    const times = [];
    for (let trial = 0; trial < 3; trial++) {
      const start = performance.now();
      const result = await detectSpeech(samples, detector);
      if (result.backend !== backend) throw new Error(`Expected ${backend}, got ${result.backend}`);
      times.push(performance.now() - start);
    }
    results[backend] = Math.round(times.sort((a,b) => a-b)[1]);
    await detector.session?.release();
    detectors.pop();
  }
  console.log(JSON.stringify({ audioSeconds, trials: 3, medianMs: results, speedup: +(results.node / results.rust).toFixed(2), note: 'Detection only; Rust timing includes process and model startup. Decoding and export excluded.' }, null, 2));
} finally {
  for (const detector of detectors) await detector.session?.release();
  await rm(dir, { recursive: true, force: true });
}
