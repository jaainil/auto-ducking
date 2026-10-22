import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, ReactNode } from "react";
import type { Project, ProjectSummary } from "../types";
import { createProject, listProjects, uploadFile } from "../lib/api";
import {
  deriveProjectName,
  formatBytes,
  formatDate,
  formatDuration,
} from "../lib/format";
import {
  ArrowRightIcon,
  CheckIcon,
  CloseIcon,
  FilmIcon,
  FolderIcon,
  LockIcon,
  MicIcon,
  MusicIcon,
  WaveIcon,
} from "./Icons";
import { Brand, DotSphere } from "./Brand";
import { DuckingDiagram } from "./DuckingDiagram";

type SlotKind = "video" | "music" | "voice";

interface SlotValue {
  file: File;
  duration: number;
  width?: number | null;
  height?: number | null;
  progress: number;
  uploadId?: string;
}

type Slots = Record<SlotKind, SlotValue | null>;

const EMPTY_SLOTS: Slots = { video: null, music: null, voice: null };

const ACCEPT: Record<SlotKind, string> = {
  video: "video/*,.mp4,.m4v,.mov,.webm,.mkv,.avi,.ogv",
  music: "audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus,.aiff",
  voice: "audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus,.aiff",
};

const EXTENSIONS: Record<SlotKind, string[]> = {
  video: ["mp4", "m4v", "mov", "webm", "mkv", "avi", "ogv"],
  music: ["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac", "opus", "aiff", "aif"],
  voice: ["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac", "opus", "aiff", "aif"],
};

const MAX_BYTES = 250 * 1024 * 1024;

function extensionOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function probeFile(file: File, kind: SlotKind) {
  return new Promise<{ duration: number; width: number | null; height: number | null }>(
    (resolve, reject) => {
      const element = document.createElement(
        kind === "video" ? "video" : "audio",
      );
      const url = URL.createObjectURL(file);
      let settled = false;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        URL.revokeObjectURL(url);
        element.removeAttribute("src");
        element.load();
        if (error) reject(error);
      };

      const timer = window.setTimeout(() => {
        finish(new Error("That file took too long to read. Try another one."));
      }, 20_000);

      element.preload = "metadata";
      element.onloadedmetadata = () => {
        const duration = element.duration;
        if (!Number.isFinite(duration) || duration <= 0) {
          finish(
            new Error(
              "The duration of that file could not be read. Try an MP4 or MP3.",
            ),
          );
          return;
        }
        const video = element as HTMLVideoElement;
        const result = {
          duration,
          width: kind === "video" ? video.videoWidth || null : null,
          height: kind === "video" ? video.videoHeight || null : null,
        };
        settled = true;
        window.clearTimeout(timer);
        URL.revokeObjectURL(url);
        resolve(result);
      };
      element.onerror = () => {
        finish(new Error("That file could not be decoded in the browser."));
      };
      element.src = url;
    },
  );
}

function RequiredBadge() {
  return <span className="slot-required">Required</span>;
}

function FileLine({
  file,
  duration,
  meta,
  onRemove,
  onReplace,
  progress,
  disabled,
}: {
  file: File;
  duration: number;
  meta: string;
  onRemove: () => void;
  onReplace: () => void;
  progress: number;
  disabled: boolean;
}) {
  return (
    <div className="file-line">
      <span className="file-icon">
        <CheckIcon size={16} />
      </span>
      <span className="file-copy">
        <span className="file-name" title={file.name}>
          {file.name}
        </span>
        <span className="file-meta">
          {formatDuration(duration)} · {meta} · {formatBytes(file.size)}
        </span>
      </span>
      <span className="file-actions">
        <button
          type="button"
          className="text-button"
          onClick={onReplace}
          disabled={disabled}
        >
          Replace
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove ${file.name}`}
        >
          <CloseIcon size={16} />
        </button>
      </span>
      {progress > 0 && progress < 100 && (
        <span className="file-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </span>
      )}
    </div>
  );
}

function Slot({
  kind,
  icon,
  title,
  hint,
  value,
  error,
  disabled,
  dragging,
  onPick,
  onDrop,
  onDragState,
  onRemove,
}: {
  kind: SlotKind;
  icon: ReactNode;
  title: string;
  hint: string;
  value: SlotValue | null;
  error?: string;
  disabled: boolean;
  dragging: boolean;
  onPick: (file: File) => void;
  onDrop: (file: File) => void;
  onDragState: (active: boolean) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    onDragState(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onDrop(file);
  };

  return (
    <div
      className={`slot${value ? " is-filled" : ""}${dragging ? " is-dragging" : ""}${error ? " has-error" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) onDragState(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        onDragState(false);
      }}
      onDrop={handleDrop}
    >
      <div className="slot-head">
        <span className="slot-kind">
          {icon}
          {title}
        </span>
        <RequiredBadge />
      </div>

      <input
        ref={input}
        type="file"
        accept={ACCEPT[kind]}
        hidden
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onPick(file);
        }}
      />

      {value ? (
        <FileLine
          file={value.file}
          duration={value.duration}
          meta={
            kind === "video" && value.width
              ? `${value.width}×${value.height}`
              : "Audio"
          }
          progress={value.progress}
          disabled={disabled}
          onReplace={() => input.current?.click()}
          onRemove={onRemove}
        />
      ) : (
        <button
          type="button"
          className="slot-empty"
          onClick={() => input.current?.click()}
          disabled={disabled}
        >
          <span className="slot-drop">
            Drop {kind === "video" ? "your video" : "a track"} here
          </span>
          <span className="slot-browse">
            or browse <span aria-hidden="true">→</span>
          </span>
          <span className="slot-hint">{hint}</span>
        </button>
      )}

      {error && <p className="slot-error">{error}</p>}
    </div>
  );
}

export function Home({
  onCreated,
  onOpenProject,
}: {
  onCreated: (project: Project) => void;
  onOpenProject: (id: string) => void;
}) {
  const [slots, setSlots] = useState<Slots>(EMPTY_SLOTS);
  const [errors, setErrors] = useState<Partial<Record<SlotKind, string>>>({});
  const [dragging, setDragging] = useState<SlotKind | null>(null);
  const [stage, setStage] = useState<"idle" | "uploading" | "analyzing">("idle");
  const [status, setStatus] = useState("");
  const [globalError, setGlobalError] = useState("");
  const [recent, setRecent] = useState<ProjectSummary[]>([]);
  const busy = stage !== "idle";

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((projects) => {
        if (!cancelled) setRecent(projects.slice(0, 4));
      })
      .catch(() => {
        /* the upload flow will surface a server error if it is down */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setSlot = (kind: SlotKind, value: SlotValue | null) => {
    setSlots((current) => ({ ...current, [kind]: value }));
  };

  const handleFile = async (kind: SlotKind, file: File) => {
    if (busy) return;
    setGlobalError("");
    setErrors((current) => ({ ...current, [kind]: undefined }));

    const extension = extensionOf(file.name);
    if (!EXTENSIONS[kind].includes(extension)) {
      setErrors((current) => ({
        ...current,
        [kind]: `That file type is not supported. Use ${kind === "video" ? "MP4, MOV, or WebM" : "MP3, WAV, or M4A"}.`,
      }));
      return;
    }

    if (file.size > MAX_BYTES) {
      setErrors((current) => ({
        ...current,
        [kind]: "That file is over 250 MB. Trim it or compress it first.",
      }));
      return;
    }

    try {
      const meta = await probeFile(file, kind);
      const limit = kind === "music" ? 1200 : 600;
      if (meta.duration > limit + 1) {
        setErrors((current) => ({
          ...current,
          [kind]: `That file is longer than ${Math.round(limit / 60)} minutes.`,
        }));
        return;
      }
      setSlot(kind, { file, ...meta, progress: 0 });
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [kind]:
          error instanceof Error
            ? error.message
            : "That file could not be read.",
      }));
    }
  };

  const handleCreate = async () => {
    const video = slots.video;
    const music = slots.music;
    if (!video || !music || busy) return;

    setGlobalError("");
    setStage("uploading");
    setStatus("Uploading your media");

    const setProgress = (kind: SlotKind, progress: number) => {
      setSlots((current) => {
        const value = current[kind];
        if (!value) return current;
        return { ...current, [kind]: { ...value, progress } };
      });
    };

    try {
      const tasks: Promise<unknown>[] = [
        uploadFile(video.file, "video", (progress) => setProgress("video", progress)).then(
          (result) => {
            video.uploadId = result.uploadId;
            return result;
          },
        ),
        uploadFile(music.file, "music", (progress) => setProgress("music", progress)).then(
          (result) => {
            music.uploadId = result.uploadId;
            return result;
          },
        ),
      ];

      if (slots.voice) {
        const voice = slots.voice;
        tasks.push(
          uploadFile(voice.file, "voice", (progress) => setProgress("voice", progress)).then(
            (result) => {
              voice.uploadId = result.uploadId;
              return result;
            },
          ),
        );
      }

      const [videoResult, , voiceResult] = (await Promise.all(tasks)) as Array<
        { uploadId: string; hasAudio?: boolean } | undefined
      >;

      if (!videoResult?.hasAudio && !voiceResult) {
        throw new Error(
          "This video has no audio track. Add a separate voiceover, or choose a video with sound.",
        );
      }

      setStage("analyzing");
      setStatus("Finding the speech");

      const project = await createProject({
        name: deriveProjectName(video.file.name),
        videoUploadId: video.file ? video.uploadId! : "",
        musicUploadId: music.uploadId!,
        voiceUploadId: slots.voice?.uploadId ?? null,
      });

      onCreated(project);
    } catch (error) {
      setStage("idle");
      setStatus("");
      setGlobalError(
        error instanceof Error
          ? error.message
          : "The mix could not be created. Try again.",
      );
    }
  };

  const isReady = Boolean(slots.video && slots.music) && !busy;
  const canDrop = (kind: SlotKind) => !busy && !slots[kind];

  return (
    <div className="app home">
      <header className="topbar">
        <div className="topbar-inner home-topbar">
          <a className="brand-link" href="#/" aria-label="AudioDuck Studio home">
            <Brand />
          </a>
          <div className="topbar-actions">
            <span className="local-chip">
              <LockIcon size={14} />
              Files stay local
            </span>
            <a className="text-link" href="#how">
              How it works
            </a>
          </div>
        </div>
      </header>

      <main className="home-main">
        <DotSphere className="dot-sphere dot-sphere-left" size={600} dot={1.2} />
        <DotSphere className="dot-sphere dot-sphere-right" size={760} dot={1.35} />

        <section className="hero" aria-labelledby="hero-title">
          <h1 id="hero-title">
            Auto-duck your music
            <br />
            in <span className="accent">one click.</span>
          </h1>
          <p className="hero-copy">
            Add a reel and a track. AudioDuck finds every spoken word, eases the
            music under it, and hands you the curve to adjust — before you
            export.
          </p>

          <div className="upload-shell">
            <div className="upload-head">
              <div>
                <h2>Start a mix</h2>
                <p>Bring a video and a music bed. We handle the rest.</p>
              </div>
              <span className="upload-badge">
                <WaveIcon size={14} /> Speech-aware
              </span>
            </div>

            <div className="slot-grid">
              <Slot
                kind="video"
                icon={<FilmIcon size={17} />}
                title="Video"
                hint="MP4, MOV, WebM · up to 10 min"
                value={slots.video}
                error={errors.video}
                disabled={busy}
                dragging={dragging === "video"}
                onPick={(file) => void handleFile("video", file)}
                onDrop={(file) => void handleFile("video", file)}
                onDragState={(active) => setDragging(active ? "video" : null)}
                onRemove={() => setSlot("video", null)}
              />
              <Slot
                kind="music"
                icon={<MusicIcon size={17} />}
                title="Background music"
                hint="MP3, WAV, M4A · loops if short"
                value={slots.music}
                error={errors.music}
                disabled={busy}
                dragging={dragging === "music"}
                onPick={(file) => void handleFile("music", file)}
                onDrop={(file) => void handleFile("music", file)}
                onDragState={(active) => setDragging(active ? "music" : null)}
                onRemove={() => setSlot("music", null)}
              />
            </div>

            <div
              className={`voice-row${slots.voice ? " is-filled" : ""}${dragging === "voice" ? " is-dragging" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                if (!busy) setDragging("voice");
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                setDragging(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(null);
                const file = event.dataTransfer.files?.[0];
                if (file && !busy) void handleFile("voice", file);
              }}
            >
              <div className="voice-copy">
                <span className="voice-icon">
                  <MicIcon size={18} />
                </span>
                <span>
                  <span className="voice-title">Separate voiceover</span>
                  <span className="voice-hint">
                    Optional. Without it, we use your video&rsquo;s audio.
                  </span>
                </span>
              </div>

              {slots.voice ? (
                <div className="voice-file">
                  <span className="voice-file-name" title={slots.voice.file.name}>
                    {slots.voice.file.name}
                  </span>
                  <span className="voice-file-meta">
                    {formatDuration(slots.voice.duration)}
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setSlot("voice", null)}
                    disabled={busy}
                    aria-label="Remove voiceover"
                  >
                    <CloseIcon size={15} />
                  </button>
                </div>
              ) : (
                <label className="ghost-button voice-pick">
                  <input
                    type="file"
                    accept={ACCEPT.voice}
                    hidden
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void handleFile("voice", file);
                    }}
                  />
                  <PlusIconSmall />
                  Choose file
                </label>
              )}
              {errors.voice && <p className="slot-error voice-error">{errors.voice}</p>}
            </div>

            {globalError && (
              <div className="form-error" role="alert">
                <span className="error-dot" aria-hidden="true" />
                {globalError}
              </div>
            )}

            <div className="upload-foot">
              <p className="local-note">
                <LockIcon size={14} />
                Processed on this machine. Files never leave it.
              </p>
              <div className="upload-actions">
                {stage === "analyzing" && (
                  <span className="analyzing" role="status">
                    <span className="pulse-dot" aria-hidden="true" />
                    {status}
                    <span className="ellipsis" aria-hidden="true" />
                  </span>
                )}
                <button
                  type="button"
                  className="button primary"
                  onClick={() => void handleCreate()}
                  disabled={!isReady}
                >
                  {stage === "uploading" ? status : "Create mix"}
                  <ArrowRightIcon size={17} />
                </button>
              </div>
            </div>

            <p className="mixed-note">
              Music already mixed into your video stays as it is. Ducking
              applies to the track added here; add a separate voiceover for full
              control.
            </p>
          </div>

          {recent.length > 0 && (
            <section className="recent" aria-labelledby="recent-title">
              <h2 id="recent-title">Recent mixes</h2>
              <div className="recent-list">
                {recent.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className="recent-row"
                    onClick={() => onOpenProject(project.id)}
                  >
                    <span className="recent-icon">
                      <FolderIcon size={18} />
                    </span>
                    <span className="recent-copy">
                      <span className="recent-name">{project.name}</span>
                      <span className="recent-meta">
                        {formatDuration(project.duration)} ·{" "}
                        {project.speechCount}{" "}
                        {project.speechCount === 1 ? "region" : "regions"} ·{" "}
                        {formatDate(project.updatedAt)}
                      </span>
                    </span>
                    <ArrowRightIcon size={18} className="recent-arrow" />
                  </button>
                ))}
              </div>
            </section>
          )}
        </section>

        <section className="proof" id="how" aria-labelledby="proof-title">
          <div className="proof-copy">
            <h2 id="proof-title">The curve does the work.</h2>
            <p>
              A compressor guesses from loudness. AudioDuck detects where speech
              actually happens, then builds a decibel-accurate volume envelope
              you can see and edit.
            </p>
            <ul className="proof-points">
              <li>
                <span className="point-icon">
                  <WaveIcon size={17} />
                </span>
                <span>
                  <strong>Speech-aware regions</strong>
                  Silero VAD finds the words; silence stays silent.
                </span>
              </li>
              <li>
                <span className="point-icon">
                  <CheckIcon size={17} />
                </span>
                <span>
                  <strong>One curve, two engines</strong>
                  The browser preview and the FFmpeg render read the same
                  envelope.
                </span>
              </li>
              <li>
                <span className="point-icon">
                  <LockIcon size={17} />
                </span>
                <span>
                  <strong>Local by default</strong>
                  Your media, project, and export stay on this machine.
                </span>
              </li>
            </ul>
          </div>
          <div className="proof-visual">
            <DuckingDiagram />
            <figure className="studio-still-life">
              <img src="/studio-still-life.webp" width="960" height="480" loading="lazy" alt="White studio headphones beside a blue audio interface" />
              <figcaption>Less time mixing. More time creating. <span>AI-generated illustration.</span></figcaption>
            </figure>
          </div>
        </section>
      </main>

      <footer className="home-footer">
        <div className="home-footer-inner">
          <span>
            AudioDuck Studio <span className="muted">· local-first audio ducking</span>
          </span>
          <span className="footer-meta">
            MP4 · WAV · MP3 <span className="muted">· no account required</span>
          </span>
        </div>
      </footer>
    </div>
  );
}

function PlusIconSmall() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
