import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { projectPath, downloadFilename } from "./storage.mjs";
import { resolveMusicTrim } from "../shared/music.js";
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
 * @param {{ format: "mp4"|"wav"|"mp3", normalize?: boolean, jobId: string }} options
 * @param {{ progress?: (percent: number, stage: string) => void, onChild?: (child: import("node:child_process").ChildProcess | null) => void, cancelled?: () => boolean }} context
 */
export async function renderProject(project, options, context = {}) {
  const format = FORMATS[options.format];
  if (!format) throw new Error("Choose MP4, WAV, or MP3");

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
    progress(3, "Building the automation curve");
    await writeAutomationWav(automation, project.segments, project.settings, duration);

    const videoPath = projectPath(project.id, project.media.video);
    const voicePath = projectPath(project.id, project.media.voiceWav);
    let musicPath = projectPath(project.id, project.media.music);
    const sourceDuration = project.source?.music?.duration ?? (await probeMedia(musicPath)).duration;
    const trim = resolveMusicTrim(project.settings, sourceDuration);
    if (trim.start > 0 || trim.end < sourceDuration - 0.0001) {
      progress(5, "Preparing selected music");
      await runFfmpeg([
        "-i", musicPath, "-ss", String(trim.start), "-t", String(trim.length),
        "-vn", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", selectedMusic,
      ], { onSpawn: child => context.onChild?.(child) });
      musicPath = selectedMusic;
    }

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

    if (options.normalize) {
      graphs.push(
        `[mix]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[normalized]`,
      );
      graphs.push(
        `[normalized]alimiter=limit=0.891:level=0,atrim=0:${duration},asetpts=N/SR/TB[out]`,
      );
    } else {
      graphs.push(
        `[mix]alimiter=limit=0.891:level=0,atrim=0:${duration},asetpts=N/SR/TB[out]`,
      );
    }

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
        timeoutMs: Math.max(120_000, duration * 4_000 + 60_000),
        onSpawn: (child) => context.onChild?.(child),
        onProgress: (seconds) => {
          if (!Number.isFinite(seconds)) return;
          const ratio = Math.min(1, seconds / duration);
          progress(8 + ratio * 82, "Mixing and rendering");
        },
      });
      context.onChild?.(null);
    };

    if (context.cancelled?.()) throw new RenderCancelled();

    if (includeVideo) {
      try {
        progress(8, "Mixing and rendering");
        await runAttempt(true);
      } catch (error) {
        if (error instanceof RenderCancelled || context.cancelled?.()) {
          throw new RenderCancelled();
        }
        await rm(output, { force: true });
        progress(10, "Transcoding the source video");
        await runAttempt(false);
      }
    } else {
      progress(8, "Mixing and rendering");
      await runAttempt(false);
    }

    progress(94, "Checking the export");
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
      normalize: Boolean(options.normalize),
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    await rm(output, { force: true });
    throw error;
  } finally {
    await rm(automation, { force: true });
    await rm(selectedMusic, { force: true });
    context.onChild?.(null);
  }
}
