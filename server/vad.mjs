import * as ort from "onnxruntime-node";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { endianness } from "node:os";
import { run } from "./media.mjs";

const nativeBinary = fileURLToPath(new URL(`../native/vad/target/release/audioduck-vad${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
const require = createRequire(import.meta.url);
const runtimeName = process.platform === "win32" ? "onnxruntime.dll" : process.platform === "darwin" ? "libonnxruntime.dylib" : "libonnxruntime.so.1";
const runtimePath = join(dirname(require.resolve("onnxruntime-node/package.json")), "bin", "napi-v6", process.platform, process.arch, runtimeName);

const SAMPLE_RATE = 16000;
const WINDOW = 512; // 32 ms at 16 kHz, the frame size Silero VAD v5 expects.
const HOP_MS = 32;
// Keep short jobs in-process: native startup can outweigh inference savings.
const NATIVE_MIN_SAMPLES = SAMPLE_RATE * 300;

/**
 * Load Silero VAD once for the process. If the model or runtime is missing,
 * the caller falls back to the local energy detector.
 * @param {string} modelPath
 * @param {{ backend?: "auto" | "node" | "rust", nativePath?: string }} [options]
 */
export async function loadVoiceDetector(modelPath, options = {}) {
  const backend = options.backend ?? process.env.VAD_BACKEND ?? "auto";
  if (!["auto", "node", "rust"].includes(backend)) throw new Error("VAD_BACKEND must be auto, node or rust");
  const nativePath = options.nativePath ?? process.env.VAD_NATIVE_PATH ?? nativeBinary;
  let useNative = false;
  if (backend !== "node") {
    try {
      await access(nativePath, constants.X_OK);
      await access(runtimePath);
      useNative = true;
    } catch (error) {
      if (backend === "rust") throw new Error(`Rust VAD unavailable: ${error.message}`);
    }
  }
  try {
    const session = await ort.InferenceSession.create(modelPath);
    return {
      engine: "silero",
      session,
      sr: new ort.Tensor("int64", BigInt64Array.from([16000n]), [1]),
      nativePath: useNative ? nativePath : null,
      modelPath,
      backend,
    };
  } catch (error) {
    if (backend === "rust") throw error;
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
  if (detector.nativePath && (detector.backend === "rust" || samples.length >= NATIVE_MIN_SAMPLES)) {
    try {
      const input = endianness() === "LE"
        ? Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
        : Buffer.allocUnsafe(samples.length * 4);
      if (endianness() !== "LE") {
        for (let i = 0; i < samples.length; i++) input.writeFloatLE(samples[i], i * 4);
      }
      const result = await run(detector.nativePath, [detector.modelPath], {
        input,
        env: { ORT_DYLIB_PATH: runtimePath },
        maxBytes: Math.max(4, Math.ceil(samples.length / WINDOW) * 4),
        timeoutMs: Math.max(30_000, samples.length / SAMPLE_RATE * 1000),
      });
      const frames = Math.ceil(samples.length / WINDOW);
      if (result.code !== 0 || result.stdout.length !== frames * 4) throw new Error(`Rust VAD failed: ${result.stderr}`);
      const probabilities = Array.from({ length: frames }, (_, i) => result.stdout.readFloatLE(i * 4));
      if (probabilities.some(p => !Number.isFinite(p) || p < 0 || p > 1)) throw new Error("Rust VAD returned invalid probabilities");
      return { engine: "silero", backend: "rust", hopMs: HOP_MS, probabilities };
    } catch (error) {
      if (detector.backend === "rust") throw error;
      detector.nativePath = null;
      console.warn(`[vad] Rust worker unavailable, using Node: ${error.message}`);
    }
  }
  if (detector.session) {
    return {
      engine: "silero",
      backend: "node",
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
