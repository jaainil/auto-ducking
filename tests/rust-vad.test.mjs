import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadVoiceDetector, detectSpeech } from '../server/vad.mjs';
import { runFfmpeg, decodePcm16k } from '../server/media.mjs';

const model = new URL('../server/models/silero_vad.onnx', import.meta.url).pathname;
const nativePath = fileURLToPath(new URL(`../native/vad/target/release/audioduck-vad${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
const nativeTests = { skip: existsSync(nativePath) ? false : 'Build the optional Rust worker with npm run build:native' };
test('Rust speech analysis matches Node across silence, speech and partial frames', nativeTests, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rust-vad-'));
  const node = await loadVoiceDetector(model, { backend: 'node' });
  const rust = await loadVoiceDetector(model, { backend: 'rust', nativePath });
  try {
    await runFfmpeg(['-f','lavfi','-i','flite=text=Welcome to Audio Duck Studio. Your voice stays clear while music fades naturally.:voice=slt','-ar','16000',join(dir,'speech.wav')]);
    const speech = await decodePcm16k(join(dir,'speech.wav'));
    for (const samples of [new Float32Array(), new Float32Array(16000), speech, speech.subarray(700, 17001)]) {
      const expected = await detectSpeech(samples, node);
      const actual = await detectSpeech(samples, rust);
      assert.equal(actual.backend, 'rust');
      assert.equal(actual.hopMs, 32);
      assert.equal(actual.probabilities.length, Math.ceil(samples.length / 512));
      actual.probabilities.forEach((p, i) => assert.ok(Math.abs(p - expected.probabilities[i]) < 1e-5, `frame ${i}: ${p} vs ${expected.probabilities[i]}`));
    }
    const [a, b] = await Promise.all([detectSpeech(speech, rust), detectSpeech(new Float32Array(16000), rust)]);
    assert.ok(a.probabilities.some(p => p > .5));
    assert.ok(b.probabilities.every(p => p < .5));
  } finally {
    await node.session.release();
    await rust.session?.release();
    await rm(dir, { recursive: true, force: true });
  }
});

test('requiring Rust reports missing and failed workers instead of silently falling back', async () => {
  await assert.rejects(loadVoiceDetector(model, { backend: 'rust', nativePath: '/missing/audioduck-vad' }), /Rust VAD unavailable/);
  const detector = await loadVoiceDetector(model, { backend: 'rust', nativePath: process.execPath });
  try {
    await assert.rejects(detectSpeech(new Float32Array(513), detector), /Rust VAD failed/);
  } finally { await detector.session.release(); }
});

test('automatic backend avoids Rust startup on short clips and uses Rust for long clips', nativeTests, async () => {
  const detector = await loadVoiceDetector(model, { backend: 'auto', nativePath });
  try {
    const short = await detectSpeech(new Float32Array(16000), detector);
    assert.equal(short.backend, 'node');
    const long = await detectSpeech(new Float32Array(300 * 16000), detector);
    assert.equal(long.backend, 'rust');
    assert.ok(long.probabilities.every(p => p < .5));
  } finally { await detector.session.release(); }
});

test('automatic analysis falls back to Node for missing or failed Rust workers', async () => {
  for (const nativePath of ['/missing/audioduck-vad', '/bin/false', '/bin/echo']) {
    const detector = await loadVoiceDetector(model, { nativePath });
    try {
      const result = await detectSpeech(new Float32Array(300 * 16000 + 1), detector);
      assert.equal(result.backend, 'node');
      assert.equal(result.probabilities.length, 9376);
      assert.ok(result.probabilities.every(p => p < .5));
    } finally { await detector.session.release(); }
  }
});
