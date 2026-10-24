import { createAdaptiveEngine } from '../../shared/adaptive-wasm.js';

const engine = fetch('/wasm/adaptive_ducking.wasm').then(response => {
  if (!response.ok) throw new Error('The adaptive audio engine could not load. Restart the backend and reload.');
  return response.arrayBuffer();
}).then(createAdaptiveEngine);
// Initialization may fail before the first message; report it through that
// request's error state rather than an unhandled worker rejection.
engine.catch(() => {});

self.onmessage = async event => {
  const { id, segments, settings, duration, rate, levels } = event.data;
  try {
    const envelope = (await engine).buildEnvelope(segments, settings, duration, rate, levels);
    self.postMessage({ id, envelope }, { transfer: [envelope.buffer] });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Adaptive ducking could not be calculated.' });
  }
};
