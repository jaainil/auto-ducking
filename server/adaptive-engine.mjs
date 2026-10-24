import { readFile } from 'node:fs/promises';
import { createAdaptiveEngine } from '../shared/adaptive-wasm.js';
let engine;
export async function adaptiveEnvelope(segments, settings, duration, rate, levels) {
  engine ??= readFile(new URL('../public/wasm/adaptive_ducking.wasm', import.meta.url)).then(createAdaptiveEngine);
  return (await engine).buildEnvelope(segments, settings, duration, rate, levels);
}
