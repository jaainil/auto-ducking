import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRmsAccumulator, analyzeAudioLevels, adaptiveLevelsKey, AnalysisQueue } from '../server/adaptive-levels.mjs';
import { runFfmpeg } from '../server/media.mjs';

test('RMS accumulator preserves anti-phase energy across arbitrary byte chunks', () => {
  const pcm = Buffer.alloc(1920 * 4);
  for (let i = 0; i < 1920; i++) pcm.writeFloatLE(i % 2 ? -0.5 : 0.5, i * 4);
  const rms = createRmsAccumulator(0.02);
  for (let i = 0; i < pcm.length; i += 7) rms.push(pcm.subarray(i, i + 7));
  assert.deepEqual(rms.finish(), [0.5]);
});

test('RMS handles silence, partial final windows and rejects nonfinite PCM', () => {
  const rms = createRmsAccumulator(0.025);
  rms.push(Buffer.alloc(1200 * 2 * 4));
  assert.deepEqual(rms.finish(), [0, 0]);
  const invalid = createRmsAccumulator(0.02);
  const pcm = Buffer.alloc(4); pcm.writeFloatLE(NaN);
  assert.throws(() => invalid.push(pcm), /finite/);
});

test('native analysis preserves stereo energy, changes in level and duration', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'adaptive-levels-'));
  try {
    const path = join(dir, 'levels.wav');
    await assert.rejects(analyzeAudioLevels(path, 0.02), /Could not analyze audio/);
    await runFfmpeg(['-f', 'lavfi', '-i', 'aevalsrc=if(lt(t\\,0.02)\\,0.5\\,0.25)|if(lt(t\\,0.02)\\,-0.5\\,-0.25):s=48000:d=0.025', '-c:a', 'pcm_f32le', path]);
    const levels = await analyzeAudioLevels(path, 0.045);
    assert.equal(levels.length, 3);
    assert.ok(Math.abs(levels[0] - 0.5) < 0.00001);
    assert.ok(levels[1] > 0 && levels[1] < levels[0]);
    assert.equal(levels[2], 0);
    const looped = await analyzeAudioLevels(path, 0.065, { loop: true });
    assert.equal(looped.length, 4);
    assert.ok(looped.every(level => level > 0.2));
    await assert.rejects(analyzeAudioLevels(path, 0.02, { cancelled: () => true }), { name: 'RenderCancelled' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('profile keys ignore fades and gains but include actual music fitting', () => {
  const project = { id: 'x', duration: 1, media: { voiceWav: 'v.wav', music: 'm.wav' } };
  assert.equal(adaptiveLevelsKey(project, {}), adaptiveLevelsKey(project, { musicFadeInMs: 500, baseMusicDb: -9 }));
  assert.notEqual(adaptiveLevelsKey(project, {}), adaptiveLevelsKey(project, { loopCrossfadeMs: 100 }));
});

test('RMS allocation bounds reject invalid durations', () => {
  for (const value of [NaN, Infinity, -1, 0, 601]) assert.throws(() => createRmsAccumulator(value), /duration/);
  assert.equal(createRmsAccumulator(0.14).finish().length, Math.ceil(0.14 * 50));
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('analysis queue bounds running and waiting work and releases after failure', async () => {
  const queue = new AnalysisQueue(2, 1);
  const gate = deferred();
  let running = 0;
  let maximum = 0;
  const work = () => queue.run(async () => {
    running++; maximum = Math.max(maximum, running);
    try { await gate.promise; } finally { running--; }
  });
  const first = work(); const second = work(); const third = work();
  await assert.rejects(work(), { status: 429 });
  gate.resolve();
  await Promise.all([first, second, third]);
  assert.equal(maximum, 2);
  await assert.rejects(queue.run(() => { throw new Error('failure'); }), /failure/);
  assert.equal(await queue.run(() => 42), 42);
});

test('analysis queue removes cancelled pending work without starting it', async () => {
  const queue = new AnalysisQueue(1, 1);
  const gate = deferred();
  const started = deferred();
  const active = queue.run(async () => { started.resolve(); await gate.promise; });
  await started.promise;
  let cancelled = false;
  let ran = false;
  const pending = queue.run(() => { ran = true; }, { cancelled: () => cancelled });
  const rejected = assert.rejects(pending, { name: 'RenderCancelled' });
  cancelled = true;
  await rejected;
  const replacement = queue.run(() => 'replacement');
  gate.resolve();
  await active;
  assert.equal(await replacement, 'replacement');
  assert.equal(ran, false);
});
