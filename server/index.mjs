import http from "node:http";
import { createReadStream } from "node:fs";
import { createGzip } from "node:zlib";
import {
  mkdir,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DATA_DIR,
  MIME_TYPES,
  PROJECT_DIR,
  UPLOAD_DIR,
  cleanupUploads,
  ensureStorage,
  extensionFor,
  isSafeId,
  listProjects,
  mediaUrl,
  moveIntoProject,
  newId,
  projectPath,
  projectSummary,
  readJson,
  removeUpload,
  safeName,
  writeJson,
  validateProjectUploads,
} from "./storage.mjs";
import {
  decodePcm16k,
  extractVoiceTracks,
  probeMedia,
} from "./media.mjs";
import { detectSpeech, loadVoiceDetector } from "./vad.mjs";
import { resolveMusicTrim } from "../shared/music.js";
import {
  DEFAULT_SETTINGS,
  LIMITS,
  clamp,
  reconcileSegments,
  segmentsFromProbabilities,
} from "../shared/envelope.js";
import { JobQueue } from "./jobs.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST_DIR = join(ROOT, "dist");
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";

const jobs = new JobQueue();

await ensureStorage();
await cleanupUploads();
await jobs.restore();

const detector = await loadVoiceDetector(
  join(ROOT, "server", "models", "silero_vad.onnx"),
);

const SETTINGS_SCHEMA = {
  reductionDb: [0, 24],
  baseMusicDb: [-36, 0],
  lookAheadMs: [0, 300],
  fadeDownMs: [40, 600],
  holdMs: [0, 1200],
  releaseMs: [100, 2000],
  threshold: [0.15, 0.85],
  minSpeechMs: [60, 600],
  minSilenceMs: [80, 1200],
  padMs: [0, 300],
  musicStartSeconds: [0, 1200],
  musicEndSeconds: [0, 1200],
  musicFadeInMs: [0, 10000],
  musicFadeOutMs: [0, 10000],
  loopCrossfadeMs: [0, 2000],
};

function log(...args) {
  console.log("[audioduck]", ...args);
}

function sendJson(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function sendError(res, status, message, code = "error") {
  sendJson(res, status, { error: message, code });
}

function applySecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
}

async function readJsonBody(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      const error = new Error("Request body is too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}

function readRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;
  const start = match[1] === "" ? null : Number(match[1]);
  const end = match[2] === "" ? null : Number(match[2]);

  if (start === null && end === null) return null;
  if (start === null) {
    const suffix = Math.min(end, size);
    return { start: size - suffix, end: size - 1 };
  }
  const safeStart = Math.min(start, size - 1);
  const safeEnd = end === null ? size - 1 : Math.min(end, size - 1);
  if (safeStart > safeEnd) return { invalid: true };
  return { start: safeStart, end: safeEnd };
}

async function serveFile(req, res, file, { download = null, cache = "no-store" } = {}) {
  const info = await stat(file).catch(() => null);
  if (!info || !info.isFile()) {
    sendError(res, 404, "File not found", "not_found");
    return;
  }

  const extension = extname(file).slice(1).toLowerCase();
  const headers = {
    "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": cache,
    "Last-Modified": info.mtime.toUTCString(),
  };
  if (download) {
    headers["Content-Disposition"] = `attachment; filename="${download.replace(/"/g, "")}"`;
  }

  // Compress text assets to improve Core Web Vitals. Media files stream raw
  // because gzip would break seeking/range requests.
  const textExtensions = new Set(["html", "css", "js", "mjs", "json", "svg", "txt", "xml"]);
  const acceptsGzip = req.headers["accept-encoding"]?.includes("gzip");
  const useGzip = textExtensions.has(extension) && acceptsGzip;

  if (useGzip) {
    headers["Content-Encoding"] = "gzip";
    headers["Vary"] = "Accept-Encoding";
  }

  const range = readRange(req.headers.range, info.size);
  if (range?.invalid) {
    res.writeHead(416, { ...headers, "Content-Range": `bytes */${info.size}` });
    res.end();
    return;
  }

  if (range) {
    // Range requests are for media; never gzip them.
    delete headers["Content-Encoding"];
    delete headers["Vary"];
    res.writeHead(206, {
      ...headers,
      "Content-Range": `bytes ${range.start}-${range.end}/${info.size}`,
      "Content-Length": range.end - range.start + 1,
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file, { start: range.start, end: range.end }).pipe(res);
    return;
  }

  if (useGzip) {
    // Omit Content-Length when gzipping so the server can use chunked encoding.
    res.writeHead(200, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file).pipe(createGzip()).pipe(res);
  } else {
    res.writeHead(200, { ...headers, "Content-Length": info.size });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  }
}

async function receiveUpload(req, res, role) {
  const url = new URL(req.url, "http://localhost");
  const originalName = safeName(
    url.searchParams.get("filename") || "upload",
    "upload",
  );
  const id = newId("u");
  const file = join(UPLOAD_DIR, `${id}.bin`);
  const metaFile = join(UPLOAD_DIR, `${id}.json`);
  const contentLength = Number(req.headers["content-length"] || 0);

  if (contentLength > LIMITS.maxFileBytes) {
    sendError(res, 413, "That file is larger than 250 MB.", "too_large");
    req.resume();
    return;
  }

  const handle = await open(file, "w");
  let total = 0;
  let aborted = false;

  try {
    for await (const chunk of req) {
      total += chunk.length;
      if (total > LIMITS.maxFileBytes) {
        aborted = true;
        break;
      }
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }

  if (aborted) {
    await rm(file, { force: true });
    sendError(res, 413, "That file is larger than 250 MB.", "too_large");
    return;
  }

  if (total === 0) {
    await rm(file, { force: true });
    sendError(res, 400, "The upload was empty.", "empty_upload");
    return;
  }

  let probe;
  try {
    probe = await probeMedia(file);
  } catch (error) {
    await rm(file, { force: true });
    sendError(res, 400, error.message, "unreadable_media");
    return;
  }

  if (role === "video" && !probe.hasVideo) {
    await rm(file, { force: true });
    sendError(res, 400, "That file does not contain a video track.", "no_video");
    return;
  }
  if ((role === "music" || role === "voice") && !probe.hasAudio) {
    await rm(file, { force: true });
    sendError(res, 400, "That file does not contain an audio track.", "no_audio");
    return;
  }

  const maxDuration =
    role === "music"
      ? Math.max(LIMITS.maxDurationSeconds, 1200)
      : LIMITS.maxDurationSeconds;
  if (probe.duration > maxDuration + 1) {
    await rm(file, { force: true });
    sendError(
      res,
      probe.duration > maxDuration ? 422 : 400,
      `That ${role === "music" ? "track" : "file"} is longer than ${Math.round(maxDuration / 60)} minutes.`,
      "too_long",
    );
    return;
  }

  if (probe.duration < 0.2) {
    await rm(file, { force: true });
    sendError(res, 400, "That file is too short to use.", "too_short");
    return;
  }

  const meta = {
    id,
    role,
    filename: originalName,
    extension: extensionFor(originalName, role),
    size: total,
    probe,
    createdAt: new Date().toISOString(),
  };
  await writeJson(metaFile, meta);
  sendJson(res, 201, {
    uploadId: id,
    filename: originalName,
    size: total,
    duration: probe.duration,
    width: probe.video?.width ?? null,
    height: probe.video?.height ?? null,
    hasAudio: probe.hasAudio,
    hasVideo: probe.hasVideo,
  });
}

function publicProject(project) {
  return {
    ...project,
    kind: project.source?.video || project.media?.video ? "video" : "audio",
    settings: { ...DEFAULT_SETTINGS, ...project.settings },
    mediaUrls: {
      video: mediaUrl(project.id, project.media.video),
      voicePreview: mediaUrl(project.id, project.media.voicePreview),
      music: mediaUrl(project.id, project.media.music),
    },
    exports: (project.exports || []).map((entry) => ({
      ...entry,
      downloadUrl: `/api/projects/${project.id}/exports/${entry.file}`,
    })),
  };
}

async function loadProjectFull(id) {
  const project = await readJson(projectPath(id, "project.json"));
  if (!project) return null;
  const vad = await readJson(projectPath(id, "vad.json"), null);
  return { ...project, vad };
}

function sanitizeSettings(input, base = DEFAULT_SETTINGS) {
  const next = { ...DEFAULT_SETTINGS, ...base };
  for (const [key, [min, max]] of Object.entries(SETTINGS_SCHEMA)) {
    const value = Number(input?.[key]);
    if (Number.isFinite(value)) next[key] = clamp(value, min, max);
  }
  return next;
}

function sanitizeSegments(input, duration) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 500)
    .map((segment, index) => {
      const start = Number(segment?.start);
      const end = Number(segment?.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      const safeStart = clamp(Math.min(start, end), 0, duration);
      const safeEnd = clamp(Math.max(start, end), 0, duration);
      if (safeEnd - safeStart < 0.02) return null;
      return {
        id:
          typeof segment.id === "string" && segment.id.length <= 40
            ? segment.id
            : `s_${index}_${Math.round(safeStart * 1000)}`,
        start: Math.round(safeStart * 1000) / 1000,
        end: Math.round(safeEnd * 1000) / 1000,
        source: segment.source === "manual" ? "manual" : "vad",
        enabled: segment.enabled !== false,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

async function createProject(body) {
  const { videoUploadId, musicUploadId, voiceUploadId } = validateProjectUploads(body);
  const videoUpload = videoUploadId
    ? await readJson(join(UPLOAD_DIR, `${videoUploadId}.json`)) : null;
  const musicUpload = await readJson(join(UPLOAD_DIR, `${musicUploadId}.json`));
  const voiceUpload = voiceUploadId
    ? await readJson(join(UPLOAD_DIR, `${voiceUploadId}.json`))
    : null;

  if (videoUploadId && (!videoUpload || videoUpload.role !== "video")) {
    const error = new Error("The video upload expired. Add it again.");
    error.status = 410;
    throw error;
  }
  if (!musicUpload || musicUpload.role !== "music") {
    const error = new Error("The music upload expired. Add it again.");
    error.status = 410;
    throw error;
  }
  if (voiceUploadId && (!voiceUpload || voiceUpload.role !== "voice")) {
    const error = new Error("The voiceover upload expired. Add it again.");
    error.status = 410;
    throw error;
  }

  if (!videoUpload?.probe.hasAudio && !voiceUpload) {
    const error = new Error(
      "This video has no audio track. Add a separate voiceover, or choose a video with sound.",
    );
    error.status = 422;
    throw error;
  }

  const duration = Math.min(
    Number((videoUpload || voiceUpload).probe.duration) || 0,
    LIMITS.maxDurationSeconds,
  );
  if (!Number.isFinite(duration) || duration <= 0.2) {
    const error = new Error("The project duration could not be read.");
    error.status = 422;
    throw error;
  }

  const id = newId("p");
  const dir = projectPath(id);
  await mkdir(dir, { recursive: true });

  const extension = (upload) =>
    upload.extension || extensionFor(upload.filename, upload.role);
  const videoName = videoUpload ? `video.${extension(videoUpload)}` : null;
  const musicName = `music.${extension(musicUpload)}`;
  const voiceSourceName = voiceUpload
    ? `voice-source.${extension(voiceUpload)}`
    : null;

  try {
    if (videoUpload) await moveIntoProject(
      { ...videoUpload, file: join(UPLOAD_DIR, `${videoUpload.id}.bin`), metaFile: join(UPLOAD_DIR, `${videoUpload.id}.json`) },
      id,
      videoName,
    );
    await moveIntoProject(
      { ...musicUpload, file: join(UPLOAD_DIR, `${musicUpload.id}.bin`), metaFile: join(UPLOAD_DIR, `${musicUpload.id}.json`) },
      id,
      musicName,
    );
    if (voiceUpload && voiceSourceName) {
      await moveIntoProject(
        { ...voiceUpload, file: join(UPLOAD_DIR, `${voiceUpload.id}.bin`), metaFile: join(UPLOAD_DIR, `${voiceUpload.id}.json`) },
        id,
        voiceSourceName,
      );
    }

    const voiceSource = voiceSourceName
      ? join(dir, voiceSourceName)
      : join(dir, videoName);
    const voiceWav = join(dir, "voice-render.wav");
    const voicePreview = join(dir, "voice-preview.m4a");

    await extractVoiceTracks(voiceSource, voiceWav, voicePreview, duration);

    const samples = await decodePcm16k(voiceWav, duration);
    const detection = await detectSpeech(samples, detector);
    const detected = segmentsFromProbabilities(
      detection.probabilities,
      detection.hopMs,
      {
        threshold: DEFAULT_SETTINGS.threshold,
        minSpeechMs: DEFAULT_SETTINGS.minSpeechMs,
        minSilenceMs: DEFAULT_SETTINGS.minSilenceMs,
        padMs: DEFAULT_SETTINGS.padMs,
      },
    );

    const segments = detected.map((segment, index) => ({
      id: `v_${index}_${Math.round(segment.start * 1000)}`,
      start: segment.start,
      end: segment.end,
      source: "vad",
      enabled: true,
    }));

    const now = new Date().toISOString();
    const project = {
      id,
      kind: videoUpload ? "video" : "audio",
      name: safeName(body.name, videoUpload ? "Untitled Reel" : "Untitled Mix"),
      createdAt: now,
      updatedAt: now,
      duration,
      source: {
        video: videoUpload ? {
          originalName: videoUpload.filename,
          stored: videoName,
          size: videoUpload.size,
          width: videoUpload.probe.video?.width ?? null,
          height: videoUpload.probe.video?.height ?? null,
          codec: videoUpload.probe.video?.codec ?? null,
          hasAudio: videoUpload.probe.hasAudio,
        } : null,
        music: {
          originalName: musicUpload.filename,
          stored: musicName,
          size: musicUpload.size,
          duration: musicUpload.probe.duration,
        },
        voice: voiceUpload
          ? {
              originalName: voiceUpload.filename,
              stored: voiceSourceName,
              duration: voiceUpload.probe.duration,
            }
          : null,
      },
      media: {
        video: videoName,
        voiceWav: "voice-render.wav",
        voicePreview: "voice-preview.m4a",
        music: musicName,
      },
      settings: { ...DEFAULT_SETTINGS },
      detected,
      segments,
      analysis: {
        engine: detection.engine,
        analyzedAt: now,
        speechCount: segments.filter((segment) => segment.enabled !== false).length,
        speechDuration: segments
          .filter((segment) => segment.enabled !== false)
          .reduce((sum, segment) => sum + (segment.end - segment.start), 0),
      },
      vadEngine: detection.engine,
      exports: [],
    };

    await writeJson(projectPath(id, "vad.json"), {
      engine: detection.engine,
      hopMs: detection.hopMs,
      probabilities: detection.probabilities,
    });
    await writeJson(projectPath(id, "project.json"), project);

    return project;
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

async function handleApi(req, res, url) {
  const path = url.pathname;
  const method = req.method || "GET";

  if (path === "/api/health" && method === "GET") {
    sendJson(res, 200, {
      ok: true,
      ffmpeg: true,
      vadEngine: detector.engine,
      limits: {
        maxDurationSeconds: LIMITS.maxDurationSeconds,
        maxFileBytes: LIMITS.maxFileBytes,
      },
      version: "0.1.0",
    });
    return;
  }

  if (path === "/api/uploads" && method === "POST") {
    const role = url.searchParams.get("role");
    if (!["video", "music", "voice"].includes(role)) {
      sendError(res, 400, "Choose a video, music, or voiceover upload.", "bad_role");
      req.resume();
      return;
    }
    await receiveUpload(req, res, role);
    return;
  }

  if (path === "/api/projects" && method === "GET") {
    sendJson(res, 200, { projects: await listProjects() });
    return;
  }

  if (path === "/api/projects" && method === "POST") {
    const body = await readJsonBody(req);
    const project = await createProject(body);
    log(`project ${project.id} created (${project.analysis.engine} VAD, ${project.segments.length} regions)`);
    const full = await loadProjectFull(project.id);
    sendJson(res, 201, { project: publicProject(full) });
    return;
  }

  const projectMatch = /^\/api\/projects\/([a-z0-9]+)(?:\/([a-z-]+))?(?:\/([^/]+))?$/.exec(
    path,
  );
  if (!projectMatch) {
    sendError(res, 404, "Not found", "not_found");
    return;
  }

  const projectId = projectMatch[1];
  const action = projectMatch[2] || null;
  const tail = projectMatch[3] || null;

  if (!isSafeId(projectId)) {
    sendError(res, 404, "Project not found", "not_found");
    return;
  }

  const project = await readJson(projectPath(projectId, "project.json"));
  if (!project) {
    sendError(res, 404, "Project not found", "not_found");
    return;
  }

  if (!action && method === "GET") {
    const full = await loadProjectFull(projectId);
    sendJson(res, 200, { project: publicProject(full) });
    return;
  }

  if (!action && method === "PATCH") {
    const body = await readJsonBody(req);
    if (typeof body.name === "string") {
      project.name = safeName(body.name, project.name);
    }
    if (body.settings && typeof body.settings === "object") {
      project.settings = sanitizeSettings(body.settings, project.settings);
      const trim = resolveMusicTrim(project.settings, project.source.music.duration);
      project.settings.musicStartSeconds = trim.start;
      project.settings.musicEndSeconds = trim.end;
    }
    if (Array.isArray(body.segments)) {
      project.segments = sanitizeSegments(body.segments, project.duration);
      project.analysis = {
        ...project.analysis,
        speechCount: project.segments.filter((segment) => segment.enabled !== false)
          .length,
        speechDuration: project.segments
          .filter((segment) => segment.enabled !== false)
          .reduce((sum, segment) => sum + (segment.end - segment.start), 0),
      };
    }
    project.updatedAt = new Date().toISOString();
    await writeJson(projectPath(projectId, "project.json"), project);
    const full = await loadProjectFull(projectId);
    sendJson(res, 200, { project: publicProject(full) });
    return;
  }

  if (!action && method === "DELETE") {
    for (const job of jobs.jobs.values()) {
      if (job.projectId === projectId) jobs.cancel(job.id);
    }
    await rm(projectPath(projectId), { recursive: true, force: true });
    sendJson(res, 200, { deleted: true });
    return;
  }

  if (action === "analyze" && method === "POST") {
    const body = await readJsonBody(req);
    const settings = sanitizeSettings(body.settings || {}, project.settings);
    const source = project.source.voice
      ? projectPath(projectId, project.source.voice.stored)
      : projectPath(projectId, project.media.voiceWav);
    const samples = await decodePcm16k(source, project.duration);
    const detection = await detectSpeech(samples, detector);
    const detected = segmentsFromProbabilities(
      detection.probabilities,
      detection.hopMs,
      {
        threshold: settings.threshold,
        minSpeechMs: settings.minSpeechMs,
        minSilenceMs: settings.minSilenceMs,
        padMs: settings.padMs,
      },
    );
    project.detected = detected;
    project.segments = reconcileSegments(
      detected,
      project.segments || [],
    );
    project.settings = settings;
    project.analysis = {
      engine: detection.engine,
      analyzedAt: new Date().toISOString(),
      speechCount: project.segments.filter((segment) => segment.enabled !== false)
        .length,
      speechDuration: project.segments
        .filter((segment) => segment.enabled !== false)
        .reduce((sum, segment) => sum + (segment.end - segment.start), 0),
    };
    project.updatedAt = new Date().toISOString();
    await writeJson(projectPath(projectId, "vad.json"), {
      engine: detection.engine,
      hopMs: detection.hopMs,
      probabilities: detection.probabilities,
    });
    await writeJson(projectPath(projectId, "project.json"), project);
    const full = await loadProjectFull(projectId);
    sendJson(res, 200, { project: publicProject(full) });
    return;
  }

  if (action === "export" && method === "POST") {
    const body = await readJsonBody(req);
    const format = body.format === "wav" || body.format === "mp3" ? body.format : "mp4";
    if (format === "mp4" && !project.media.video) {
      sendError(res, 422, "Audio-only projects support WAV or MP3 export. Choose an audio format.", "audio_only_export");
      return;
    }
    const job = jobs.enqueue(project, {
      format,
      normalize: Boolean(body.normalize),
    });
    sendJson(res, 202, { job });
    return;
  }

  if (action === "exports" && tail && method === "GET") {
    if (tail !== basename(tail)) {
      sendError(res, 404, "Export not found", "not_found");
      return;
    }
    const file = projectPath(projectId, "exports", tail);
    const record = (project.exports || []).find((entry) => entry.file === tail);
    await serveFile(req, res, file, {
      download: record?.filename || tail,
      cache: "private, max-age=0, must-revalidate",
    });
    return;
  }

  sendError(res, 405, "Method not allowed", "method_not_allowed");
}

async function handleJob(req, res, url) {
  const match = /^\/api\/jobs\/([a-z0-9]+)(?:\/(cancel))?$/.exec(url.pathname);
  if (!match) {
    sendError(res, 404, "Job not found", "not_found");
    return;
  }

  const jobId = match[1];
  const cancel = match[2] === "cancel";

  if (cancel && req.method === "POST") {
    const job = jobs.cancel(jobId);
    if (!job) {
      sendError(res, 404, "Job not found", "not_found");
      return;
    }
    sendJson(res, 200, { job });
    return;
  }

  if (req.method === "GET") {
    const job = jobs.get(jobId);
    if (job) {
      sendJson(res, 200, { job });
      return;
    }
    // A finished job survives a restart in the project's exports directory.
    const projects = await listProjects();
    for (const entry of projects) {
      const record = await readJson(
        projectPath(entry.id, "exports", `${jobId}.json`),
        null,
      );
      if (record) {
        sendJson(res, 200, {
          job: {
            ...record,
            output: record.output
              ? {
                  ...record.output,
                  downloadUrl: `/api/projects/${entry.id}/exports/${record.output.file}`,
                }
              : null,
          },
        });
        return;
      }
    }
    sendError(res, 404, "Job not found", "not_found");
    return;
  }

  sendError(res, 405, "Method not allowed", "method_not_allowed");
}

async function handleMedia(req, res, url) {
  const match = /^\/media\/([a-z0-9]+)\/([^/]+)$/.exec(url.pathname);
  if (!match || !isSafeId(match[1])) {
    sendError(res, 404, "Media not found", "not_found");
    return;
  }

  const projectId = match[1];
  const filename = decodeURIComponent(match[2]);
  if (filename !== basename(filename)) {
    sendError(res, 404, "Media not found", "not_found");
    return;
  }

  const file = projectPath(projectId, filename);
  await serveFile(req, res, file, {
    cache: "private, max-age=3600",
  });
}

async function handleStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendError(res, 405, "Method not allowed", "method_not_allowed");
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  if (pathname.includes("..")) {
    sendError(res, 404, "Not found", "not_found");
    return;
  }

  const candidate = normalize(join(DIST_DIR, pathname));
  if (!candidate.startsWith(DIST_DIR + sep) && candidate !== DIST_DIR) {
    sendError(res, 404, "Not found", "not_found");
    return;
  }

  const info = await stat(candidate).catch(() => null);
  if (info?.isFile()) {
    const cache = pathname.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache";
    await serveFile(req, res, candidate, { cache });
    return;
  }

  const index = join(DIST_DIR, "index.html");
  const indexInfo = await stat(index).catch(() => null);
  if (!indexInfo) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("AudioDuck Studio is not built yet. Run `npm run build` or use `npm run dev`.");
    return;
  }

  // The app uses hash routing, so the server only needs to serve "/" and real
  // files. Returning index.html for unknown paths would create soft 404s.
  sendError(res, 404, "Page not found", "not_found");
}

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res);
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (url.pathname.startsWith("/api/jobs/")) {
      await handleJob(req, res, url);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    if (url.pathname.startsWith("/media/")) {
      await handleMedia(req, res, url);
      return;
    }
    await handleStatic(req, res, url);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) log("request failed:", error.stack || error.message);
    if (!res.headersSent) {
      sendError(res, status, error.message || "Something went wrong");
    } else {
      res.destroy();
    }
  }
});

server.requestTimeout = 20 * 60 * 1000;
server.headersTimeout = 60 * 1000;

server.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT}`);
  log(`voice detection: ${detector.engine}`);
  log(`data: ${DATA_DIR}`);
});

function shutdown() {
  log("shutting down");
  for (const job of jobs.jobs.values()) {
    if (job.child) job.child.kill("SIGTERM");
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2500).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
