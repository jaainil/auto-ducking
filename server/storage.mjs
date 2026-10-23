import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

export const DATA_DIR = resolve(process.env.DATA_DIR || "data");
export const UPLOAD_DIR = join(DATA_DIR, "uploads");
export const PROJECT_DIR = join(DATA_DIR, "projects");

export const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "m4a",
  "aac",
  "ogg",
  "oga",
  "flac",
  "opus",
  "aiff",
  "aif",
]);
export const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "m4v",
  "mov",
  "webm",
  "mkv",
  "avi",
  "ogv",
]);

export const MIME_TYPES = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
  opus: "audio/ogg",
  aiff: "audio/aiff",
  aif: "audio/aiff",
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  html: "text/html; charset=utf-8",
  json: "application/json; charset=utf-8",
  woff2: "font/woff2",
  woff: "font/woff",
};

export async function ensureStorage() {
  await mkdir(UPLOAD_DIR, { recursive: true });
  await mkdir(PROJECT_DIR, { recursive: true });
}

export function newId(prefix = "") {
  return `${prefix}${randomBytes(8).toString("hex")}`;
}

export function isSafeId(id) {
  return typeof id === "string" && /^[a-z0-9]{8,32}$/.test(id);
}

/** @param {string} id */
export function projectPath(id, ...parts) {
  if (!isSafeId(id)) throw new Error("Invalid project id");
  return join(PROJECT_DIR, id, ...parts);
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJson(file, value) {
  const temporary = `${file}.${randomBytes(3).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, file);
}

export function safeName(name, fallback = "Untitled Reel") {
  const cleaned = String(name ?? "")
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

export function extensionFor(filename, role) {
  const extension = extname(String(filename ?? "")).slice(1).toLowerCase();
  const allowed = role === "video" ? VIDEO_EXTENSIONS : AUDIO_EXTENSIONS;
  return allowed.has(extension) ? extension : role === "video" ? "mp4" : "mp3";
}

export async function moveIntoProject(upload, projectId, targetName) {
  const destination = projectPath(projectId, targetName);
  await mkdir(projectPath(projectId), { recursive: true });
  await rename(upload.file, destination);
  await rm(upload.metaFile, { force: true });
  return destination;
}

export async function listProjects() {
  const entries = await readdir(PROJECT_DIR, { withFileTypes: true }).catch(
    () => [],
  );
  const projects = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeId(entry.name)) continue;
    const project = await readJson(projectPath(entry.name, "project.json"));
    if (!project) continue;
    projects.push(projectSummary(project));
  }

  return projects.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export function projectSummary(project) {
  return {
    id: project.id,
    kind: project.source?.video || project.media?.video ? "video" : "audio",
    name: project.name,
    duration: project.duration,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    width: project.source?.video?.width ?? null,
    height: project.source?.video?.height ?? null,
    speechCount: Array.isArray(project.segments)
      ? project.segments.filter((segment) => segment.enabled !== false).length
      : 0,
    vadEngine: project.vadEngine ?? null,
  };
}

export async function removeUpload(uploadId) {
  if (!isSafeId(uploadId)) return;
  await rm(join(UPLOAD_DIR, `${uploadId}.bin`), { force: true });
  await rm(join(UPLOAD_DIR, `${uploadId}.json`), { force: true });
}

export async function cleanupUploads(maxAgeMs = 24 * 60 * 60 * 1000) {
  const entries = await readdir(UPLOAD_DIR, { withFileTypes: true }).catch(
    () => [],
  );
  const now = Date.now();

  for (const entry of entries) {
    const file = join(UPLOAD_DIR, entry.name);
    const info = await stat(file).catch(() => null);
    if (info && now - info.mtimeMs > maxAgeMs) {
      await rm(file, { force: true });
    }
  }
}

export function mediaUrl(projectId, filename) {
  return filename ? `/media/${projectId}/${encodeURIComponent(basename(filename))}` : null;
}

export function downloadFilename(project, format) {
  const base = safeName(project.name, "AudioDuck mix")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 50);
  return `${base || "AudioDuck-mix"}-ducked.${format}`;
}

export { basename, join };

export function validateProjectUploads(body) {
  const videoUploadId = body?.videoUploadId ?? null;
  const musicUploadId = body?.musicUploadId;
  const voiceUploadId = body?.voiceUploadId ?? null;
  if (!isSafeId(musicUploadId) || (videoUploadId !== null && !isSafeId(videoUploadId)) || (voiceUploadId !== null && !isSafeId(voiceUploadId))) {
    throw Object.assign(new Error("Choose valid media uploads to start."), { status: 400 });
  }
  if (!videoUploadId && !voiceUploadId) {
    throw Object.assign(new Error("Add a voice track and background music for an audio mix."), { status: 400 });
  }
  return { videoUploadId, musicUploadId, voiceUploadId };
}
