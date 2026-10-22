import * as ort from "onnxruntime-node";

const SAMPLE_RATE = 16000;
const WINDOW = 512; // 32 ms at 16 kHz, the frame size Silero VAD v5 expects.
const HOP_MS = 32;

/**
 * Load Silero VAD once for the process. If the model or runtime is missing,
 * the caller falls back to the local energy detector.
 * @param {string} modelPath
 */
export async function loadVoiceDetector(modelPath) {
  try {
    const session = await ort.InferenceSession.create(modelPath);
    return {
      engine: "silero",
      session,
      sr: new ort.Tensor("int64", BigInt64Array.from([16000n]), [1]),
    };
  } catch (error) {
    console.warn(
      `[vad] Silero VAD unavailable, using the local detector: ${error.message}`,
    );
    return { engine: "energy", session: null };
  }
}

/**
 * @param {Float32Array} samples mono 16 kHz
 * @param {{ engine: string, session: import("onnxruntime-node").InferenceSession | null, sr?: import("onnxruntime-node").Tensor }} detector
 */
export async function detectSpeech(samples, detector) {
  if (detector.session) {
    return {
      engine: "silero",
      hopMs: HOP_MS,
      probabilities: await runSilero(samples, detector),
    };
  }

  return {
    engine: "energy",
    hopMs: HOP_MS,
    probabilities: energyProbabilities(samples),
  };
}

/**
 * @param {Float32Array} samples
 * @param {{ session: import("onnxruntime-node").InferenceSession, sr: import("onnxruntime-node").Tensor }} detector
 */
async function runSilero(samples, detector) {
  const probabilities = [];
  const contextSize = 64;
  let context = new Float32Array(contextSize);
  let state = new ort.Tensor(
    "float32",
    new Float32Array(2 * 1 * 128),
    [2, 1, 128],
  );

  const total = Math.ceil(samples.length / WINDOW);

  for (let frame = 0; frame < total; frame += 1) {
    const data = new Float32Array(contextSize + WINDOW);
    data.set(context, 0);
    const offset = frame * WINDOW;
    const length = Math.min(WINDOW, samples.length - offset);
    if (length > 0) data.set(samples.subarray(offset, offset + length), contextSize);

    const input = new ort.Tensor("float32", data, [1, contextSize + WINDOW]);
    const output = await detector.session.run({
      input,
      state,
      sr: detector.sr,
    });

    state = output.stateN;
    context = data.slice(-contextSize);
    const probability = output.output.data[0];
    probabilities.push(Number.isFinite(probability) ? probability : 0);
  }

  return probabilities;
}

/**
 * Adaptive RMS detector used when the Silero model is unavailable. It still
 * produces frame probabilities, so the rest of the pipeline is unchanged.
 * @param {Float32Array} samples
 */
export function energyProbabilities(samples) {
  const frameCount = Math.ceil(samples.length / WINDOW);
  const levels = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * WINDOW;
    const length = Math.min(WINDOW, samples.length - offset);
    let sum = 0;
    for (let i = 0; i < length; i += 1) {
      const sample = samples[offset + i];
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / Math.max(1, length));
    levels[frame] = 20 * Math.log10(Math.max(rms, 1e-8));
  }

  const sorted = Array.from(levels).sort((a, b) => a - b);
  const percentile = sorted[Math.floor(sorted.length * 0.2)] ?? -70;
  const threshold = Math.max(percentile + 8, -48);

  const probabilities = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const level = levels[frame];
    if (level < -62) {
      probabilities[frame] = 0;
      continue;
    }
    probabilities[frame] = 1 / (1 + Math.exp(-(level - threshold) / 2.4));
  }

  // Light smoothing keeps single-frame clicks from becoming speech regions.
  const smoothed = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const a = probabilities[Math.max(0, frame - 1)];
    const b = probabilities[frame];
    const c = probabilities[Math.min(frameCount - 1, frame + 1)];
    smoothed[frame] = Math.max((a + b + c) / 3, b * 0.9);
  }

  return Array.from(smoothed);
}

export { HOP_MS, SAMPLE_RATE };
