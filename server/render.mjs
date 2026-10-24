import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { projectPath, downloadFilename } from "./storage.mjs";
import { prepareMusic } from "./music-preparation.mjs";
import { getAdaptiveLevels } from "./adaptive-levels.mjs";
import { adaptiveEnvelope } from "./adaptive-engine.mjs";
import { LIMITS } from "../shared/envelope.js";
import { resolveMastering, getMasteringPreset } from "../shared/mastering.js";
import { analysisFilter, parseLoudness, masteringFilter, qualityReport } from "./mastering.mjs";
import {
  probeMedia,
  runFfmpeg,
  writeAutomationWav,
} from "./media.mjs";

export class RenderCancelled extends Error {
  constructor() {
    super("Render cancelled");
    this.name = "RenderCancelled";
  }
}

const FORMATS = {
  mp4: { extension: "mp4", audioCodec: ["aac", "-b:a", "192k"], label: "MP4" },
  wav: { extension: "wav", audioCodec: ["pcm_s16le"], label: "WAV" },
  mp3: { extension: "mp3", audioCodec: ["libmp3lame", "-b:a", "192k"], label: "MP3" },
};

/**
 * Mix the voice and ducked music and, for MP4, keep the source video.
 *
 * @param {any} project
 * @param {{ format: "mp4"|"wav"|"mp3", normalize?: boolean, mastering?: { enabled: boolean, preset: string }, jobId: string }} options
 * @param {{ progress?: (percent: number, stage: string) => void, onChild?: (child: import("node:child_process").ChildProcess | null) => void, cancelled?: () => boolean }} context
 */
export async function renderProject(project, options, context = {}) {
  const format = FORMATS[options.format];
  if (!format) throw new Error("Choose MP4, WAV, or MP3");
  const mastering = resolveMastering(options);
  const preset = getMasteringPreset(mastering.preset);

  if (options.format === "mp4" && !project.media.video) throw new Error("MP4 requires a video source");

  const duration = Number(project.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("The project has no usable duration");
  }

  const dir = projectPath(project.id);
  const exportsDir = join(dir, "exports");
  await mkdir(exportsDir, { recursive: true });

  const automation = join(dir, `automation-${options.jobId}.wav`);
  const selectedMusic = join(dir, `music-selection-${options.jobId}.wav`);
  const output = join(exportsDir, `render-${options.jobId}.${format.extension}`);

  const progress = (percent, stage) => {
    if (context.cancelled?.()) throw new RenderCancelled();
    context.progress?.(Math.max(0, Math.min(100, percent)), stage);
  };

  try {
    let adaptive = null;
    if (project.settings.duckingMode === "adaptive") {
      progress(2, "Analyzing source audio levels");
      const levels = await getAdaptiveLevels(project, project.settings, context);
      adaptive = await adaptiveEnvelope(project.segments, project.settings, duration, LIMITS.renderEnvelopeRate, levels);
    }
    progress(3, "Building the automation curve");
    await writeAutomationWav(automation, project.segments, project.settings, duration, adaptive);

    const videoPath = project.media.video ? projectPath(project.id, project.media.video) : null;
    const voicePath = projectPath(project.id, project.media.voiceWav);
    progress(5, "Preparing selected music");
    const { musicPath } = await prepareMusic(project, selectedMusic, context);

    const includeVideo = options.format === "mp4";
    const voiceIndex = includeVideo ? 1 : 0;
    const musicIndex = voiceIndex + 1;
    const automationIndex = musicIndex + 1;

    const baseDb = Number(project.settings.baseMusicDb) || 0;
    const graphs = [
      `[${voiceIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_dur=${duration},atrim=0:${duration},asetpts=PTS-STARTPTS[voice]`,
      `[${musicIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${baseDb}dB,atrim=0:${duration},asetpts=PTS-STARTPTS[music]`,
      `[${automationIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[gain]`,
      `[music][gain]amultiply[ducked]`,
      `[voice][ducked]amix=inputs=2:duration=longest:normalize=0[mix]`,
    ];

    const inputs = includeVideo
      ? [
          "-i",
          videoPath,
          "-i",
          voicePath,
          "-stream_loop",
          "-1",
          "-i",
          musicPath,
          "-i",
          automation,
        ]
      : [
          "-i",
          voicePath,
          "-stream_loop",
          "-1",
          "-i",
          musicPath,
          "-i",
          automation,
        ];

    const outputArgs = [
      "-map",
      ...(includeVideo ? ["0:v:0", "-map", "[out]"] : ["[out]"]),
      "-t",
      String(duration),
      "-ar",
      "48000",
      ...(includeVideo
        ? [
            "-c:v",
            "copy",
            "-c:a",
            ...format.audioCodec,
            "-movflags",
            "+faststart",
            "-max_muxing_queue_size",
            "1024",
          ]
        : ["-vn", "-c:a", ...format.audioCodec]),
      "-progress",
      "pipe:1",
      "-nostats",
      output,
    ];

    const timeoutMs = Math.max(120_000, duration * 4_000 + 60_000);
    const processOptions = { timeoutMs, onSpawn: child => context.onChild?.(child) };
    let before = null;
    let masteringReport = null;
    let peakCeiling = preset.truePeakDbtp - 0.5;
    if (mastering.enabled) {
      progress(8, "Analyzing mix loudness");
      const analysis = await runFfmpeg([
        ...inputs, "-loglevel", "info", "-filter_complex",
        [...graphs, `[mix]${analysisFilter(preset)}[analysis]`].join(";"),
        "-map", "[analysis]", "-t", String(duration),
        "-progress", "pipe:1", "-nostats", "-f", "null", "-",
      ], { ...processOptions, onProgress: seconds => {
        if (Number.isFinite(seconds)) progress(8 + Math.min(1, seconds / duration) * 22, "Analyzing mix loudness");
      } });
      context.onChild?.(null);
      before = parseLoudness(analysis.stderr);
    }
    const finishGraph = () => `[mix]${mastering.enabled
      ? masteringFilter(preset, before, peakCeiling)
      : "alimiter=limit=0.891:level=0"},aresample=48000,atrim=0:${duration},asetpts=N/SR/TB[out]`;
    graphs.push(finishGraph());
    let renderStart = mastering.enabled ? 32 : 8;
    let renderSpan = mastering.enabled ? 46 : 82;
    const runAttempt = async (copyVideo) => {
      const args = [
        ...inputs,
        "-filter_complex",
        graphs.join(";"),
        ...(copyVideo
          ? outputArgs
          : outputArgs.map((arg) =>
              arg === "copy" ? "libx264" : arg,
            )),
      ];

      if (!copyVideo) {
        // Insert the transcode tuning right after "libx264".
        const index = args.indexOf("libx264");
        if (index >= 0) {
          args.splice(
            index + 1,
            0,
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
          );
        }
      }

      await runFfmpeg(args, {
        timeoutMs,
        onSpawn: (child) => context.onChild?.(child),
        onProgress: (seconds) => {
          if (!Number.isFinite(seconds)) return;
          const ratio = Math.min(1, seconds / duration);
          progress(renderStart + ratio * renderSpan, mastering.enabled ? "Mastering and rendering" : "Mixing and rendering");
        },
      });
      context.onChild?.(null);
    };

    if (context.cancelled?.()) throw new RenderCancelled();

    const renderOutput = async () => {
      if (includeVideo) {
        try {
          progress(renderStart, mastering.enabled ? "Mastering and rendering" : "Mixing and rendering");
          await runAttempt(true);
        } catch (error) {
          if (error instanceof RenderCancelled || context.cancelled?.()) {
            throw new RenderCancelled();
          }
          await rm(output, { force: true });
          progress(renderStart, "Transcoding the source video");
          await runAttempt(false);
        }
      } else {
        progress(renderStart, mastering.enabled ? "Mastering and rendering" : "Mixing and rendering");
        await runAttempt(false);
      }
    };
    await renderOutput();

    if (mastering.enabled) {
      const measureOutput = async (start, span) => {
        progress(start, "Checking mastered audio");
        const measured = await runFfmpeg([
          "-loglevel", "info", "-i", output, "-map", "0:a:0", "-vn",
          "-af", analysisFilter(preset), "-progress", "pipe:1", "-nostats", "-f", "null", "-",
        ], { ...processOptions, onProgress: seconds => {
          if (Number.isFinite(seconds)) progress(start + Math.min(1, seconds / duration) * span, "Checking mastered audio");
        } });
        context.onChild?.(null);
        return parseLoudness(measured.stderr);
      };
      let after = await measureOutput(80, 7);
      // Lossy codecs can add intersample peaks. Allow one measured correction.
      if (after.truePeakDbtp !== null && after.truePeakDbtp > preset.truePeakDbtp + 0.1 && before.integratedLufs !== null) {
        peakCeiling = Math.max(-9, peakCeiling - (after.truePeakDbtp - preset.truePeakDbtp) - 0.2);
        graphs[graphs.length - 1] = finishGraph();
        renderStart = 88;
        renderSpan = 5;
        progress(88, "Adding peak headroom");
        await renderOutput();
        after = await measureOutput(94, 3);
      }
      masteringReport = qualityReport(preset, before, after);
    }

    progress(mastering.enabled ? 98 : 94, "Checking the export");
    const info = await probeMedia(output);
    const outputSize = (await stat(output)).size;

    if (!info.hasAudio) throw new Error("The export has no audio stream");
    if (includeVideo && !info.hasVideo) {
      throw new Error("The export lost the source video stream");
    }
    if (Math.abs(info.duration - duration) > Math.max(0.75, duration * 0.01)) {
      throw new Error("The export duration does not match the timeline");
    }
    if (outputSize < 1024) throw new Error("The export file is empty");

    progress(100, "Ready to download");

    return {
      file: `render-${options.jobId}.${format.extension}`,
      filename: downloadFilename(project, format.extension),
      size: outputSize,
      duration: info.duration,
      format: format.extension,
      normalize: mastering.enabled,
      mastering: masteringReport,
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    await rm(output, { force: true });
    if (context.cancelled?.()) throw new RenderCancelled();
    throw error;
  } finally {
    context.onChild?.(null);
    await rm(automation, { force: true });
    await rm(selectedMusic, { force: true });
    context.onChild?.(null);
  }
}
