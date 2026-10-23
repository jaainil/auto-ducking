import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { musicFadeAt } from "../shared/music.js";
import { buildEnvelope, LIMITS } from "../shared/envelope.js";

/**
 * Spawn a process without a shell. Arguments are always arrays so no user
 * string can become part of a command line.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ collect?: boolean, maxBytes?: number, timeoutMs?: number, onStdout?: (chunk: Buffer) => void, onStderr?: (chunk: Buffer) => void }} [options]
 */
export function run(command, args, options = {}) {
  const {
    collect = true,
    maxBytes = 350 * 1024 * 1024,
    timeoutMs = 15 * 60 * 1000,
    onStdout,
    onStderr,
    onSpawn,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, AV_LOG_FORCE_NOCOLOR: "1" },
    });

    if (onSpawn) onSpawn(child);

    /** @type {Buffer[]} */
    const stdout = [];
    /** @type {Buffer[]} */
    const stderr = [];
    let outputBytes = 0;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      if (onStdout) onStdout(chunk);
      if (collect) {
        outputBytes += chunk.length;
        if (outputBytes > maxBytes) {
          child.kill("SIGKILL");
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(new Error(`${command} produced too much output`));
          }
          return;
        }
        stdout.push(chunk);
      }
    });

    child.stderr.on("data", (chunk) => {
      if (onStderr) onStderr(chunk);
      if (stderr.length < 400) stderr.push(chunk);
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code: code ?? -1,
        signal: signal ?? null,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString("utf8"),
        child,
      });
    });
  });
}

/**
 * @param {string[]} args
 * @param {{ onProgress?: (seconds: number) => void, timeoutMs?: number }} [options]
 */
export async function runFfmpeg(args, options = {}) {
  const fullArgs = [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-loglevel",
    "error",
    ...args,
  ];

  const result = await run("ffmpeg", fullArgs, {
    collect: false,
    timeoutMs: options.timeoutMs ?? 15 * 60 * 1000,
    onSpawn: options.onSpawn,
    onStdout: (chunk) => {
      if (!options.onProgress) return;
      const text = chunk.toString("utf8");
      for (const line of text.split("\n")) {
        const match = /^out_time_us=(\d+)/.exec(line.trim());
        if (match) options.onProgress(Number(match[1]) / 1_000_000);
        if (line.trim() === "progress=end") options.onProgress(Number.NaN);
      }
    },
    onStderr: () => {},
  });

  if (result.code !== 0) {
    const detail = result.stderr
      .split("\n")
      .filter((line) => line.trim())
      .slice(-4)
      .join(" ");
    throw new Error(`FFmpeg failed${detail ? `: ${detail}` : ""}`);
  }

  return result;
}

/** @param {string} file */
export async function probeMedia(file) {
  const result = await run("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    file,
  ]);

  if (result.code !== 0) {
    throw new Error("That file could not be read as audio or video.");
  }

  const info = JSON.parse(result.stdout.toString("utf8"));
  const streams = Array.isArray(info.streams) ? info.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const formatDuration = Number(info.format?.duration);
  const streamDuration = Number(video?.duration ?? audio?.duration);
  const duration = Number.isFinite(formatDuration)
    ? formatDuration
    : Number.isFinite(streamDuration)
      ? streamDuration
      : 0;

  return {
    duration,
    format: info.format?.format_name ?? "unknown",
    size: Number(info.format?.size ?? 0),
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    video: video
      ? {
          codec: video.codec_name,
          width: Number(video.width),
          height: Number(video.height),
          pixelFormat: video.pix_fmt,
          rotation: Number(
            video.tags?.rotate ??
              video.side_data_list?.find((entry) => "rotation" in entry)?.rotation ??
              0,
          ),
        }
      : null,
    audio: audio
      ? {
          codec: audio.codec_name,
          sampleRate: Number(audio.sample_rate),
          channels: Number(audio.channels),
        }
      : null,
  };
}

/**
 * Decode the first audio stream to mono 16 kHz Float32 PCM for VAD.
 * @param {string} file
 * @param {number} [maxSeconds]
 */
export async function decodePcm16k(file, maxSeconds = LIMITS.maxDurationSeconds) {
  const result = await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "error",
      "-i",
      file,
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-t",
      String(maxSeconds),
      "-f",
      "s16le",
      "pipe:1",
    ],
    { maxBytes: 240 * 1024 * 1024, timeoutMs: 5 * 60 * 1000 },
  );

  if (result.code !== 0) {
    throw new Error("No usable audio track was found in that file.");
  }

  const buffer = result.stdout;
  const samples = new Float32Array(Math.floor(buffer.length / 2));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = buffer.readInt16LE(i * 2) / 32768;
  }
  return samples;
}

/**
 * Produce a render-grade WAV and a light preview file from a video or voice
 * upload. Both keep the speech untouched apart from downmixing to mono.
 *
 * @param {string} source
 * @param {string} outWav
 * @param {string} outPreview
 * @param {number} duration
 */
export async function extractVoiceTracks(source, outWav, outPreview, duration) {
  await mkdir(dirname(outWav), { recursive: true });

  await runFfmpeg([
    "-i",
    source,
    "-map",
    "0:a:0",
    "-vn",
    "-ac",
    "1",
    "-ar",
    "48000",
    "-c:a",
    "pcm_s16le",
    "-t",
    String(duration),
    outWav,
    "-map",
    "0:a:0",
    "-vn",
    "-ac",
    "1",
    "-ar",
    "44100",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-t",
    String(duration),
    outPreview,
  ]);
}

/**
 * Write the automation curve as a stereo 16-bit WAV. This is a control signal,
 * not audible audio: FFmpeg multiplies the music by it sample by sample.
 *
 * @param {string} file
 * @param {{ start: number, end: number, enabled?: boolean }[]} segments
 * @param {import("../shared/envelope.js").DuckingSettings} settings
 * @param {number} duration
 */
export async function writeAutomationWav(file, segments, settings, duration) {
  const rate = LIMITS.renderEnvelopeRate;
  const envelope = buildEnvelope(segments, settings, duration, rate);
  const frames = envelope.length;
  const byteCount = frames * 4;
  const wav = Buffer.alloc(44 + byteCount);

  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + byteCount, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(byteCount, 40);

  for (let i = 0; i < frames; i += 1) {
    const value = Math.max(0, Math.min(32767, Math.round(envelope[i] * musicFadeAt(i / rate, duration, settings) * 32767)));
    wav.writeInt16LE(value, 44 + i * 4);
    wav.writeInt16LE(value, 46 + i * 4);
  }

  const { writeFile } = await import("node:fs/promises");
  await writeFile(file, wav);
  return envelope;
}
