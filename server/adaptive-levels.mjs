import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { run } from './media.mjs';
import { prepareMusic, checkCancelled } from './music-preparation.mjs';

const cache = new Map();
const HOP_SAMPLES = 960;

/** Bound independent analysis jobs while letting each caller cancel its own wait. */
export class AnalysisQueue {
  #active = 0;
  #pending = [];
  constructor(concurrency = 2, maxPending = 8) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(maxPending) || maxPending < 0) {
      throw new Error('Invalid analysis queue limits');
    }
    this.concurrency = concurrency;
    this.maxPending = maxPending;
  }
  async run(work, context = {}) {
    checkCancelled(context);
    if (this.#active < this.concurrency) {
      this.#active++;
    } else {
      if (this.#pending.length >= this.maxPending) {
        const error = new Error('Audio analysis is busy. Try again shortly.');
        error.status = 429;
        throw error;
      }
      await new Promise((resolve, reject) => {
        const entry = { resolve, reject, context, timer: null };
        entry.timer = setInterval(() => {
          try { checkCancelled(context); }
          catch (error) {
            const index = this.#pending.indexOf(entry);
            if (index !== -1) this.#pending.splice(index, 1);
            clearInterval(entry.timer);
            reject(error);
          }
        }, 25);
        this.#pending.push(entry);
      });
    }
    try {
      checkCancelled(context);
      return await work();
    } finally {
      this.#active--;
      while (this.#pending.length && this.#active < this.concurrency) {
        const entry = this.#pending.shift();
        clearInterval(entry.timer);
        try { checkCancelled(entry.context); }
        catch (error) { entry.reject(error); continue; }
        this.#active++;
        entry.resolve();
      }
    }
  }
}

const analysisQueue = new AnalysisQueue();

export function adaptiveLevelsKey(project, settings = project.settings) {
  return JSON.stringify([project.id, project.media.voiceWav, project.media.music, Number(project.duration), project.source?.music?.duration ?? null,
    Number(settings?.musicStartSeconds) || 0, Number(settings?.musicEndSeconds) || 0, Number(settings?.loopCrossfadeMs) || 0]);
}

/** Incrementally consume interleaved stereo float PCM; never downmix channels. */
export function createRmsAccumulator(duration) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 600) throw new Error('Audio duration must be between 0 and 600 seconds');
  const levels = Array(Math.ceil(duration * 50)).fill(0);
  let pending = Buffer.alloc(0);
  let count = 0;
  let sum = 0;
  let window = 0;
  function sample(value) {
    if (!Number.isFinite(value)) throw new Error('Audio contains non-finite samples');
    sum += value * value;
    count++;
    if (count === HOP_SAMPLES * 2) {
      if (window < levels.length) levels[window] = Math.sqrt(sum / count);
      window++; count = 0; sum = 0;
    }
  }
  return {
    push(chunk) {
      let offset = 0;
      if (pending.length) {
        const needed = 4 - pending.length;
        if (chunk.length < needed) { pending = Buffer.concat([pending, chunk]); return; }
        const complete = Buffer.concat([pending, chunk.subarray(0, needed)]);
        sample(complete.readFloatLE(0)); pending = Buffer.alloc(0); offset = needed;
      }
      for (; offset + 4 <= chunk.length; offset += 4) sample(chunk.readFloatLE(offset));
      if (offset < chunk.length) pending = Buffer.from(chunk.subarray(offset));
    },
    finish() {
      if (pending.length || count % 2) throw new Error('Incomplete stereo audio sample');
      if (count && window < levels.length) levels[window] = Math.sqrt(sum / count);
      return levels;
    },
  };
}

export async function analyzeAudioLevels(path, duration, context = {}) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 600) throw new Error('The project has no usable duration');
  checkCancelled(context);
  const accumulator = createRmsAccumulator(duration);
  const filter = `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,${context.loop ? '' : `apad=whole_dur=${duration},`}atrim=0:${duration},asetpts=PTS-STARTPTS`;
  try {
    const result = await run('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', ...(context.loop ? ['-stream_loop', '-1'] : []), '-i', path, '-vn', '-af', filter, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'], {
      collect: false, timeoutMs: 300000,
      onSpawn: child => context.onChild?.(child),
      onStdout: chunk => { checkCancelled(context); accumulator.push(chunk); },
    });
    checkCancelled(context);
    if (result.code !== 0) throw new Error(`Could not analyze audio: ${result.stderr.trim() || 'FFmpeg failed'}`);
  } finally { context.onChild?.(null); }
  checkCancelled(context);
  return accumulator.finish();
}

export async function getAdaptiveLevels(project, settings = project.settings, context = {}) {
  checkCancelled(context);
  const duration = Number(project.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 600) throw new Error('The project has no usable duration');
  const key = adaptiveLevelsKey(project, settings);
  if (cache.has(key)) return cache.get(key);
  return analysisQueue.run(async () => {
    if (cache.has(key)) return cache.get(key);
    const { projectPath } = await import('./storage.mjs');
    const temporaryPath = projectPath(project.id, `adaptive-music-${randomUUID()}.wav`);
    try {
      const { musicPath } = await prepareMusic({ ...project, settings }, temporaryPath, context);
      const voiceRms = await analyzeAudioLevels(projectPath(project.id, project.media.voiceWav), duration, context);
      const musicRms = await analyzeAudioLevels(musicPath, duration, { ...context, loop: true });
      checkCancelled(context);
      const profile = { hopMs: 20, voiceRms, musicRms };
      cache.set(key, profile);
      while (cache.size > 8) cache.delete(cache.keys().next().value);
      return profile;
    } finally { await rm(temporaryPath, { force: true }); }
  }, context);
}
