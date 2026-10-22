import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import {
  analyzeProject,
  cancelJob,
  getJob,
  getProject,
  patchProject,
  startExport,
} from "../lib/api";
import { PreviewAudio } from "../lib/audioEngine";
import {
  addRegion,
  removeRegion,
  resetToDetection,
  toggleRegion,
  updateRegion,
} from "../lib/segments";
import {
  clamp,
  formatBytes,
  formatDate,
  formatDb,
  formatDuration,
  formatRegion,
  formatTimecode,
} from "../lib/format";
import { buildEnvelope, DEFAULT_SETTINGS } from "../../shared/envelope.js";
import type {
  DuckingSettings,
  ExportRecord,
  Peaks,
  Project,
  RenderJob,
  Segment,
} from "../types";
import { Brand } from "./Brand";
import { Timeline } from "./Timeline";
import {
  AlertIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  DownloadIcon,
  LockIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  ResetIcon,
  SkipBackIcon,
  SkipForwardIcon,
  TrashIcon,
  WaveIcon,
} from "./Icons";

const ENVELOPE_RATE = 200;

function keyFor(settings: DuckingSettings, segments: Segment[]) {
  return JSON.stringify({ settings, segments });
}

function detectionKey(settings: DuckingSettings) {
  return [
    settings.threshold,
    settings.minSpeechMs,
    settings.minSilenceMs,
    settings.padMs,
  ].join("|");
}

function engineLabel(engine: string | null | undefined) {
  if (!engine) return "Detecting engine";
  return engine === "silero" ? "Silero VAD" : "Energy detector";
}

function dbLabel(value: number) {
  if (Math.abs(value) < 0.05) return "0 dB";
  return formatDb(value);
}

function msLabel(value: number) {
  return `${Math.round(value)} ms`;
}

function numberLabel(value: number) {
  return Number(value).toFixed(2);
}

function terminalStatus(status: RenderJob["status"]) {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

function toExportRecord(job: RenderJob): ExportRecord | null {
  if (!job.output) return null;
  return {
    id: job.id,
    file: job.output.file,
    filename: job.output.filename,
    format: job.format,
    size: job.output.size,
    duration: job.output.duration,
    normalize: job.output.normalize,
    createdAt: job.output.createdAt,
    downloadUrl: job.output.downloadUrl,
  };
}

export function Editor({
  projectId,
  onBack,
}: {
  projectId: string;
  onBack: () => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [settings, setSettings] = useState<DuckingSettings | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [title, setTitle] = useState("");
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [bypass, setBypass] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  const [audioLoading, setAudioLoading] = useState(true);
  const [audioError, setAudioError] = useState("");
  const [audioToken, setAudioToken] = useState(0);
  const [playError, setPlayError] = useState("");

  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [saveError, setSaveError] = useState("");

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const [format, setFormat] = useState<"mp4" | "wav" | "mp3">("mp4");
  const [normalize, setNormalize] = useState(false);
  const [exportJob, setExportJob] = useState<RenderJob | null>(null);
  const [exportStarting, setExportStarting] = useState(false);
  const [exportError, setExportError] = useState("");

  const engineRef = useRef<PreviewAudio | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const savedKeyRef = useRef("");
  const detectionBaselineRef = useRef("");
  const saveTimerRef = useRef<number | null>(null);
  const saveSeqRef = useRef(0);
  const currentTimeRef = useRef(0);
  const playingRef = useRef(false);
  const durationRef = useRef(0);
  const togglePlayRef = useRef<() => void>(() => {});
  const seekRef = useRef<(time: number) => void>(() => {});
  const copyTimerRef = useRef<number | null>(null);

  const duration = project?.duration ?? 0;

  currentTimeRef.current = currentTime;
  playingRef.current = playing;
  durationRef.current = duration;

  const envelope = useMemo(() => {
    if (!settings || !project) return new Float32Array([1]);
    return buildEnvelope(segments, settings, project.duration, ENVELOPE_RATE);
  }, [settings, segments, project]);

  const currentKey = useMemo(
    () => (settings ? keyFor(settings, segments) : ""),
    [settings, segments],
  );

  const detectionDirty = Boolean(
    settings &&
      detectionBaselineRef.current &&
      detectionKey(settings) !== detectionBaselineRef.current,
  );

  const selectedSegment = selectedId
    ? segments.find((segment) => segment.id === selectedId) ?? null
    : null;

  const audibleCount = segments.filter(
    (segment) => segment.enabled !== false,
  ).length;
  const speechDuration = segments
    .filter((segment) => segment.enabled !== false)
    .reduce((sum, segment) => sum + (segment.end - segment.start), 0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    setProject(null);
    setSettings(null);
    setSegments([]);
    setPeaks(null);
    setPlaying(false);
    setCurrentTime(0);
    setSelectedId(null);
    setExportJob(null);
    setExportError("");
    setAnalyzeError("");
    setSaveError("");
    setSaveState("saved");
    savedKeyRef.current = "";
    detectionBaselineRef.current = "";

    getProject(projectId)
      .then((loaded) => {
        if (cancelled) return;
        setProject(loaded);
        setSettings(loaded.settings);
        setSegments(loaded.segments);
        setTitle(loaded.name);
        savedKeyRef.current = keyFor(loaded.settings, loaded.segments);
        detectionBaselineRef.current = detectionKey(loaded.settings);
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "This mix could not be loaded.",
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, reloadToken]);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    const engine = new PreviewAudio();
    engineRef.current = engine;
    setAudioLoading(true);
    setAudioError("");
    setPlayError("");
    setPeaks(null);

    engine
      .load(
        {
          voice: project.mediaUrls.voicePreview,
          music: project.mediaUrls.music,
        },
        project.duration,
      )
      .then((result) => {
        if (cancelled) return;
        setPeaks(result.peaks);
        setAudioLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setAudioLoading(false);
        setAudioError(
          error instanceof Error
            ? error.message
            : "The preview audio could not be loaded.",
        );
      });

    return () => {
      cancelled = true;
      engine.destroy();
      if (engineRef.current === engine) {
        engineRef.current = null;
      }
      setPlaying(false);
    };
  }, [project?.id, audioToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    engineRef.current?.setAutomation(
      envelope,
      settings?.baseMusicDb ?? -12,
      bypass,
    );
  }, [envelope, settings?.baseMusicDb, bypass, audioToken]);

  useEffect(() => {
    document.title = project
      ? `${title || "Untitled mix"} — AudioDuck Studio`
      : "AudioDuck Studio";
    return () => {
      document.title = "AudioDuck Studio — Auto-duck your music in one click";
    };
  }, [project, title]);

  const seek = useCallback(
    (time: number) => {
      const safe = clamp(time, 0, durationRef.current);
      setCurrentTime(safe);
      const engine = engineRef.current;
      const video = videoRef.current;

      if (playingRef.current && safe >= durationRef.current - 0.02) {
        engine?.pause();
        setPlaying(false);
        video?.pause();
        return;
      }

      engine?.seek(safe);
      if (video) {
        try {
          video.currentTime = safe;
        } catch {
          /* metadata may still be loading */
        }
      }
    },
    [],
  );

  seekRef.current = seek;

  const pausePlayback = useCallback(() => {
    const engine = engineRef.current;
    const time = engine?.pause() ?? currentTimeRef.current;
    setPlaying(false);
    setCurrentTime(time);
    videoRef.current?.pause();
  }, []);

  const togglePlay = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine?.loaded || audioLoading) return;
    if (playingRef.current) {
      pausePlayback();
      return;
    }

    setPlayError("");
    const from = currentTimeRef.current >= durationRef.current - 0.05
      ? 0
      : currentTimeRef.current;

    try {
      await engine.play(from);
      setPlaying(true);
      setCurrentTime(from);
      const video = videoRef.current;
      if (video) {
        video.muted = true;
        try {
          video.currentTime = from;
        } catch {
          /* metadata may still be loading */
        }
        await video.play().catch(() => {
          /* The audio preview still plays if the video cannot. */
        });
      }
    } catch (error) {
      setPlaying(false);
      setPlayError(
        error instanceof Error
          ? error.message
          : "Playback could not start. Try pressing play again.",
      );
    }
  }, [audioLoading, pausePlayback]);

  togglePlayRef.current = () => {
    void togglePlay();
  };

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const engine = engineRef.current;
      if (!engine) return;
      const time = engine.currentTime;
      setCurrentTime(time);

      const video = videoRef.current;
      if (video && Math.abs(video.currentTime - time) > 0.35) {
        try {
          video.currentTime = time;
        } catch {
          /* ignore a transient seek failure */
        }
      }

      if (time >= durationRef.current - 0.03) {
        engine.pause();
        setPlaying(false);
        setCurrentTime(durationRef.current);
        videoRef.current?.pause();
        return;
      }

      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          'input, textarea, select, button, a, [contenteditable="true"]',
        )
      ) {
        return;
      }

      if (event.code === "Space" || event.key.toLowerCase() === "k") {
        event.preventDefault();
        togglePlayRef.current();
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekRef.current(currentTimeRef.current - 2);
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        seekRef.current(currentTimeRef.current + 2);
      }

      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        setBypass((value) => !value);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const commitSave = useCallback(async (): Promise<boolean> => {
    if (!project || !settings) return false;
    const key = keyFor(settings, segments);
    const seq = ++saveSeqRef.current;
    setSaveState("saving");
    setSaveError("");

    try {
      const updated = await patchProject(project.id, { settings, segments });
      if (seq !== saveSeqRef.current) return false;
      savedKeyRef.current = key;
      setProject((current) =>
        current
          ? {
              ...current,
              updatedAt: updated.updatedAt,
              analysis: updated.analysis,
            }
          : current,
      );
      setSaveState("saved");
      setSaveError("");
      return true;
    } catch (error) {
      if (seq === saveSeqRef.current) {
        setSaveState("error");
        setSaveError(
          error instanceof Error
            ? error.message
            : "The mix could not be saved.",
        );
      }
      return false;
    }
  }, [project?.id, settings, segments]);

  useEffect(() => {
    if (!project || !settings || !currentKey) return;
    if (!savedKeyRef.current) {
      savedKeyRef.current = currentKey;
      return;
    }
    if (currentKey === savedKeyRef.current) return;

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void commitSave();
    }, 700);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [currentKey, commitSave, project?.id]);

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!project || !settings) return false;
    if (keyFor(settings, segments) === savedKeyRef.current) return true;
    return commitSave();
  }, [project?.id, settings, segments, commitSave]);

  const commitTitle = useCallback(async (): Promise<boolean> => {
    if (!project) return false;
    const next = title.trim().slice(0, 80);
    if (!next) {
      setTitle(project.name);
      return false;
    }
    if (next === project.name) {
      setTitle(project.name);
      return true;
    }

    setSaveState("saving");
    try {
      const updated = await patchProject(project.id, { name: next });
      setProject((current) =>
        current
          ? { ...current, name: updated.name, updatedAt: updated.updatedAt }
          : current,
      );
      setTitle(updated.name);
      setSaveState("saved");
      setSaveError("");
      return true;
    } catch (error) {
      setSaveState("error");
      setSaveError(
        error instanceof Error ? error.message : "The title could not be saved.",
      );
      return false;
    }
  }, [project?.id, project?.name, title]);

  const handleBack = async () => {
    pausePlayback();
    await commitTitle();
    const saved = await saveNow();
    if (!saved) {
      const leave = window.confirm(
        "This mix could not be saved. Leave and keep the last saved version?",
      );
      if (!leave) return;
    }
    onBack();
  };

  const handleAnalyze = async () => {
    if (!project || analyzing) return;
    setAnalyzing(true);
    setAnalyzeError("");

    try {
      const saved = await saveNow();
      if (!saved) {
        setAnalyzeError(
          "Your changes could not be saved, so detection did not run.",
        );
        return;
      }
      const updated = await analyzeProject(project.id);
      setProject(updated);
      setSettings(updated.settings);
      setSegments(updated.segments);
      setSelectedId(null);
      detectionBaselineRef.current = detectionKey(updated.settings);
      savedKeyRef.current = keyFor(updated.settings, updated.segments);
      setSaveState("saved");
    } catch (error) {
      setAnalyzeError(
        error instanceof Error
          ? error.message
          : "Speech detection could not run.",
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAddRegion = () => {
    if (!project) return;
    const start = clamp(
      Math.min(currentTimeRef.current, project.duration - 0.55),
      0,
      project.duration,
    );
    const end = Math.min(project.duration, start + 1.5);
    const next = addRegion(segments, start, end);
    const added = next.find(
      (segment) => !segments.some((existing) => existing.id === segment.id),
    );
    setSegments(next);
    setSelectedId(added?.id ?? null);
  };

  const handleUpdateSegment = (id: string, start: number, end: number) => {
    if (!project) return;
    const safeStart = clamp(start, 0, project.duration);
    const safeEnd = clamp(end, safeStart + 0.05, project.duration);
    setSegments((current) =>
      updateRegion(current, id, { start: safeStart, end: safeEnd }),
    );
  };

  const handleToggleSegment = (id: string) => {
    setSegments((current) => toggleRegion(current, id));
  };

  const handleRemoveSegment = (id: string) => {
    setSegments((current) => removeRegion(current, id));
    if (selectedId === id) setSelectedId(null);
  };

  const handleResetSegments = () => {
    if (!project) return;
    const confirmed = window.confirm(
      "Replace the current regions with the last automatic detection? Manual edits will be discarded.",
    );
    if (!confirmed) return;
    setSegments(resetToDetection(project));
    setSelectedId(null);
  };

  const handleCopySettings = async () => {
    if (!settings) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(settings, null, 2),
      );
      setCopied(true);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const handleExport = async () => {
    if (!project || exportStarting) return;
    if (exportJob && !terminalStatus(exportJob.status)) return;
    setExportStarting(true);
    setExportError("");

    try {
      const saved = await saveNow();
      if (!saved) {
        setExportError(
          "Your changes could not be saved, so the render was not started.",
        );
        return;
      }
      const job = await startExport(project.id, { format, normalize });
      setExportJob(job);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "The render could not start.",
      );
    } finally {
      setExportStarting(false);
    }
  };

  const handleCancelExport = async () => {
    if (!exportJob || terminalStatus(exportJob.status)) return;
    try {
      const job = await cancelJob(exportJob.id);
      setExportJob(job);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "The render could not cancel.",
      );
    }
  };

  useEffect(() => {
    if (!exportJob || terminalStatus(exportJob.status)) return;
    let cancelled = false;
    let timer = 0;

    const tick = async () => {
      try {
        const job = await getJob(exportJob.id);
        if (cancelled) return;
        setExportJob(job);

        if (job.status === "completed") {
          const record = toExportRecord(job);
          if (record) {
            setProject((current) => {
              if (!current) return current;
              const exists = current.exports.some(
                (entry) => entry.id === record.id,
              );
              return exists
                ? current
                : { ...current, exports: [record, ...current.exports].slice(0, 10) };
            });
          }
          return;
        }

        if (terminalStatus(job.status)) return;
        timer = window.setTimeout(tick, 1100);
      } catch (error) {
        if (cancelled) return;
        setExportError(
          error instanceof Error
            ? error.message
            : "The render status could not be checked.",
        );
        timer = window.setTimeout(tick, 2200);
      }
    };

    timer = window.setTimeout(tick, 900);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [exportJob?.id]);

  const retryAudio = () => {
    setAudioToken((token) => token + 1);
  };

  const handleVideoEnded = () => {
    const engine = engineRef.current;
    engine?.pause();
    setPlaying(false);
    setCurrentTime(durationRef.current);
  };

  if (loading) {
    return (
      <div className="app editor">
        <header className="topbar editor-topbar">
          <div className="topbar-inner editor-topbar-inner">
            <div className="editor-topbar-left">
              <a className="brand-link" href="#/" aria-label="AudioDuck Studio home">
                <Brand compact />
              </a>
            </div>
          </div>
        </header>
        <main className="editor-loading" aria-label="Loading mix">
          <div className="skeleton skeleton-head" />
          <div className="skeleton-grid">
            <div className="skeleton skeleton-preview" />
            <div className="skeleton-side">
              <div className="skeleton skeleton-panel" />
              <div className="skeleton skeleton-panel short" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (loadError || !project || !settings) {
    return (
      <div className="app editor">
        <header className="topbar editor-topbar">
          <div className="topbar-inner editor-topbar-inner">
            <div className="editor-topbar-left">
              <a className="brand-link" href="#/" aria-label="AudioDuck Studio home">
                <Brand compact />
              </a>
            </div>
          </div>
        </header>
        <div className="load-error">
          <span className="error-icon">
            <AlertIcon size={22} />
          </span>
          <h1>This mix could not be opened.</h1>
          <p>{loadError || "The project data is incomplete."}</p>
          <div className="button-row" style={{ justifyContent: "center" }}>
            <button
              type="button"
              className="button secondary"
              onClick={() => setReloadToken((token) => token + 1)}
            >
              Try again
            </button>
            <button type="button" className="button quiet" onClick={onBack}>
              All mixes
            </button>
          </div>
        </div>
      </div>
    );
  }

  const video = project.source.video;
  const portrait = Boolean(video.height && video.width && video.height > video.width);
  const jobActive = Boolean(exportJob && !terminalStatus(exportJob.status));
  const activeExport = exportJob?.output ? toExportRecord(exportJob) : null;
  const previousExports = project.exports.filter(
    (entry) => entry.id !== exportJob?.id,
  );

  return (
    <div className="app editor">
      <header className="topbar editor-topbar">
        <div className="topbar-inner editor-topbar-inner">
          <div className="editor-topbar-left">
            <a
              className="brand-link"
              href="#/"
              aria-label="AudioDuck Studio home"
              onClick={(event) => {
                event.preventDefault();
                void handleBack();
              }}
            >
              <Brand compact />
            </a>
            <button type="button" className="text-button" onClick={() => void handleBack()}>
              All mixes
            </button>
          </div>

          <div className="editor-topbar-center">
            <input
              className="title-input"
              value={title}
              maxLength={80}
              aria-label="Mix title"
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => void commitTitle()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  setTitle(project.name);
                  event.currentTarget.blur();
                }
              }}
            />
            <span className="project-subtitle">
              <span>{formatDuration(duration)}</span>
              <span className="subtitle-dot" />
              <span>
                {audibleCount} {audibleCount === 1 ? "region" : "regions"}
              </span>
              <span className="subtitle-dot" />
              <span>{engineLabel(project.vadEngine)}</span>
            </span>
          </div>

          <div className="editor-topbar-actions">
            <span
              className={`save-state${saveState === "saving" ? " is-saving" : ""}${saveState === "error" ? " is-error" : ""}`}
              title={saveError || "Changes save automatically on this machine."}
            >
              <span className="save-dot" />
              {saveState === "saving"
                ? "Saving"
                : saveState === "error"
                  ? "Save failed"
                  : "Saved locally"}
            </span>
            {saveState === "error" && (
              <button
                type="button"
                className="text-button"
                onClick={() => void saveNow()}
              >
                Retry
              </button>
            )}
            <button
              type="button"
              className="button secondary small"
              onClick={() =>
                document
                  .getElementById("export-panel")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              Export mix
              <ArrowRightIcon size={15} />
            </button>
          </div>
        </div>
      </header>

      <main className="editor-main">
        <div className="editor-grid">
          <div className="editor-canvas">
            <section className="preview-card" aria-labelledby="preview-title">
              <div className="preview-card-head">
                <h2 id="preview-title">Video preview</h2>
                <span className="preview-meta">
                  <span>{engineLabel(project.vadEngine)}</span>
                  <span className="subtitle-dot" />
                  <span>
                    {video.width && video.height
                      ? `${video.width}×${video.height}`
                      : "Video"}
                  </span>
                  <span className="subtitle-dot" />
                  <span>{formatDuration(duration)}</span>
                </span>
              </div>

              <div className="preview-stage">
                <div
                  className={`preview-frame${portrait ? " is-portrait" : ""}`}
                >
                  <video
                    ref={videoRef}
                    src={project.mediaUrls.video}
                    muted
                    playsInline
                    preload="metadata"
                    aria-label={`Preview of ${project.name}`}
                    onLoadedMetadata={() => {
                      if (videoRef.current) {
                        try {
                          videoRef.current.currentTime = currentTimeRef.current;
                        } catch {
                          /* ignore */
                        }
                      }
                    }}
                    onEnded={handleVideoEnded}
                  />
                  <span className="preview-badge">
                    <span className="live-dot" />
                    {bypass ? "Original music" : "Ducking preview"}
                  </span>
                </div>
              </div>

              <div className="transport">
                <div className="transport-controls">
                  <button
                    type="button"
                    className="transport-skip"
                    onClick={() => seek(currentTime - 2)}
                    aria-label="Back two seconds"
                    title="Back two seconds"
                  >
                    <SkipBackIcon size={17} />
                  </button>
                  <button
                    type="button"
                    className="transport-play"
                    onClick={() => void togglePlay()}
                    disabled={audioLoading || Boolean(audioError)}
                    aria-label={playing ? "Pause preview" : "Play preview"}
                    title={
                      audioLoading
                        ? "Preparing the audio preview"
                        : playing
                          ? "Pause preview"
                          : "Play preview"
                    }
                  >
                    {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
                  </button>
                  <button
                    type="button"
                    className="transport-skip"
                    onClick={() => seek(currentTime + 2)}
                    aria-label="Forward two seconds"
                    title="Forward two seconds"
                  >
                    <SkipForwardIcon size={17} />
                  </button>
                </div>

                <span className="transport-time">
                  <span>{formatTimecode(currentTime, true)}</span>
                  <span className="slash">/</span>
                  <span className="total">{formatTimecode(duration)}</span>
                </span>

                <span className="transport-spacer" />

                <div className="segmented" role="group" aria-label="Preview mix">
                  <button
                    type="button"
                    className={!bypass ? "is-active" : ""}
                    aria-pressed={!bypass}
                    onClick={() => setBypass(false)}
                  >
                    Ducked
                  </button>
                  <button
                    type="button"
                    className={bypass ? "is-active" : ""}
                    aria-pressed={bypass}
                    onClick={() => setBypass(true)}
                  >
                    Original
                  </button>
                </div>

                <span className="transport-hint">
                  Space to play · B to compare
                </span>
              </div>

              {(audioError || playError) && (
                <div className="preview-error" role="alert">
                  <AlertIcon size={15} />
                  <span>{audioError || playError}</span>
                  {audioError && (
                    <button type="button" className="text-button" onClick={retryAudio}>
                      Reload audio
                    </button>
                  )}
                </div>
              )}
            </section>

            <section className="timeline-card" aria-labelledby="timeline-title">
              <div className="timeline-head">
                <div>
                  <h2 id="timeline-title">Timeline</h2>
                  <p>
                    The blue line is your music automation. Edit a region to change
                    when the music ducks.
                  </p>
                </div>
                <div className="timeline-tools">
                  <span className="auto-badge">
                    <WaveIcon size={13} />
                    Auto-generated
                  </span>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={handleAddRegion}
                    disabled={analyzing}
                  >
                    <PlusIcon size={14} />
                    Add region
                  </button>
                </div>
              </div>

              <Timeline
                duration={duration}
                segments={segments}
                settings={settings}
                peaks={peaks}
                currentTime={currentTime}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onSeek={seek}
                onUpdateSegment={handleUpdateSegment}
                loading={audioLoading}
                error={audioError}
              />

              <div className="regions">
                <div className="regions-head">
                  <h3>
                    Speech regions{" "}
                    <span className="region-count">({audibleCount} active)</span>
                  </h3>
                  <div className="panel-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={handleResetSegments}
                      disabled={analyzing || project.detected.length === 0}
                    >
                      <ResetIcon size={13} />
                      Reset to detection
                    </button>
                  </div>
                </div>

                <div className="region-list" role="list">
                  {segments.length === 0 && (
                    <p className="region-empty">
                      No speech regions yet. Move the playhead and add a region, or
                      lower the speech threshold and detect again.
                    </p>
                  )}
                  {segments.map((segment, index) => (
                    <div
                      key={segment.id}
                      role="listitem"
                      className={`region-row${selectedId === segment.id ? " is-selected" : ""}`}
                    >
                      <button
                        type="button"
                        className={`region-toggle${segment.enabled !== false ? " is-on" : ""}`}
                        onClick={() => handleToggleSegment(segment.id)}
                        aria-pressed={segment.enabled !== false}
                        aria-label={
                          segment.enabled !== false
                            ? `Mute speech region ${index + 1}`
                            : `Enable speech region ${index + 1}`
                        }
                        title={
                          segment.enabled !== false
                            ? "Mute this region"
                            : "Enable this region"
                        }
                      >
                        <CheckIcon size={12} />
                      </button>

                      <button
                        type="button"
                        className="region-row-main"
                        onClick={() => {
                          setSelectedId(segment.id);
                          seek(segment.start);
                        }}
                        title="Select and preview from this region"
                      >
                        <span className="region-time">
                          {formatRegion(segment.start, segment.end)}
                        </span>
                        <span className="region-duration">
                          {formatDuration(segment.end - segment.start)}
                        </span>
                      </button>

                      <span
                        className={`region-source${segment.source === "manual" ? " manual" : ""}`}
                      >
                        {segment.source === "manual" ? "Edited" : "Detected"}
                      </span>

                      <div className="region-actions">
                        <button
                          type="button"
                          className="region-remove"
                          onClick={() => handleRemoveSegment(segment.id)}
                          aria-label={`Remove speech region ${index + 1}`}
                          title="Remove region"
                        >
                          <TrashIcon size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {selectedSegment && (
                  <RegionInspector
                    key={selectedSegment.id}
                    segment={selectedSegment}
                    duration={duration}
                    onChange={handleUpdateSegment}
                    onRemove={() => handleRemoveSegment(selectedSegment.id)}
                  />
                )}
              </div>
            </section>
          </div>

          <aside className="editor-side">
            <section className="panel" aria-labelledby="ducking-title">
              <div className="panel-head">
                <h2 id="ducking-title">Ducking</h2>
                <div className="panel-actions">
                  <span className="panel-hint">Speech-aware</span>
                  <button type="button" className="text-button" onClick={() => void handleCopySettings()}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              <div className="panel-body settings-body">
                <SliderField
                  label="Music reduction"
                  value={settings.reductionDb}
                  min={0}
                  max={24}
                  step={0.5}
                  display={dbLabel(-settings.reductionDb)}
                  hint="How far the music drops while someone speaks."
                  onChange={(value) =>
                    setSettings((current) =>
                      current ? { ...current, reductionDb: value } : current,
                    )
                  }
                />
                <SliderField
                  label="Music level"
                  value={settings.baseMusicDb}
                  min={-36}
                  max={0}
                  step={0.5}
                  display={dbLabel(settings.baseMusicDb)}
                  hint="The resting level of the music between phrases."
                  onChange={(value) =>
                    setSettings((current) =>
                      current ? { ...current, baseMusicDb: value } : current,
                    )
                  }
                />
                <div className="settings-divider" />
                <SliderField
                  label="Fade down"
                  value={settings.fadeDownMs}
                  min={40}
                  max={600}
                  step={10}
                  display={msLabel(settings.fadeDownMs)}
                  hint="How quickly the music eases down before speech."
                  onChange={(value) =>
                    setSettings((current) =>
                      current ? { ...current, fadeDownMs: value } : current,
                    )
                  }
                />
                <SliderField
                  label="Hold"
                  value={settings.holdMs}
                  min={0}
                  max={1200}
                  step={10}
                  display={msLabel(settings.holdMs)}
                  hint="Keeps the music down through short pauses."
                  onChange={(value) =>
                    setSettings((current) =>
                      current ? { ...current, holdMs: value } : current,
                    )
                  }
                />
                <SliderField
                  label="Recovery"
                  value={settings.releaseMs}
                  min={100}
                  max={2000}
                  step={10}
                  display={msLabel(settings.releaseMs)}
                  hint="How gradually the music comes back up."
                  onChange={(value) =>
                    setSettings((current) =>
                      current ? { ...current, releaseMs: value } : current,
                    )
                  }
                />
                <SliderField
                  label="Look-ahead"
                  value={settings.lookAheadMs}
                  min={0}
                  max={300}
                  step={10}
                  display={msLabel(settings.lookAheadMs)}
                  hint="Starts the fade just before speech begins."
                  onChange={(value) =>
                    setSettings((current) =>
                      current ? { ...current, lookAheadMs: value } : current,
                    )
                  }
                />

                <div className="settings-divider" />

                <button
                  type="button"
                  className="detection-toggle"
                  aria-expanded={advancedOpen}
                  onClick={() => setAdvancedOpen((open) => !open)}
                >
                  <span>Speech detection</span>
                  <ChevronDownIcon size={16} className="chevron" />
                </button>

                {advancedOpen && (
                  <div className="detection-body">
                    <p className="settings-note">
                      These settings decide where speech starts and ends. They are
                      saved with the mix and applied when you detect again.
                    </p>

                    <SliderField
                      label="Speech threshold"
                      value={settings.threshold}
                      min={0.15}
                      max={0.85}
                      step={0.01}
                      display={numberLabel(settings.threshold)}
                      hint="Lower catches quieter speech; higher ignores more noise."
                      onChange={(value) =>
                        setSettings((current) =>
                          current ? { ...current, threshold: value } : current,
                        )
                      }
                    />
                    <SliderField
                      label="Minimum speech"
                      value={settings.minSpeechMs}
                      min={60}
                      max={600}
                      step={10}
                      display={msLabel(settings.minSpeechMs)}
                      hint="Short blips below this length are ignored."
                      onChange={(value) =>
                        setSettings((current) =>
                          current ? { ...current, minSpeechMs: value } : current,
                        )
                      }
                    />
                    <SliderField
                      label="Merge pauses under"
                      value={settings.minSilenceMs}
                      min={80}
                      max={1200}
                      step={10}
                      display={msLabel(settings.minSilenceMs)}
                      hint="Short gaps join into one continuous region."
                      onChange={(value) =>
                        setSettings((current) =>
                          current ? { ...current, minSilenceMs: value } : current,
                        )
                      }
                    />
                    <SliderField
                      label="Speech padding"
                      value={settings.padMs}
                      min={0}
                      max={300}
                      step={5}
                      display={msLabel(settings.padMs)}
                      hint="Extends each region slightly on both sides."
                      onChange={(value) =>
                        setSettings((current) =>
                          current ? { ...current, padMs: value } : current,
                        )
                      }
                    />

                    {detectionDirty && (
                      <span className="detection-dirty">
                        Detection settings changed — detect again to update regions.
                      </span>
                    )}

                    {analyzeError && (
                      <div className="export-error" role="alert">
                        {analyzeError}
                      </div>
                    )}

                    <button
                      type="button"
                      className="button secondary small wide"
                      onClick={() => void handleAnalyze()}
                      disabled={analyzing}
                    >
                      {analyzing ? "Listening for speech…" : "Detect speech again"}
                    </button>
                    <p className="settings-note">
                      Manual regions and deliberate deletions are kept when you
                      detect again.
                    </p>
                  </div>
                )}

                <div className="button-row">
                  <button
                    type="button"
                    className="button quiet small"
                    onClick={() => setSettings({ ...DEFAULT_SETTINGS })}
                  >
                    <ResetIcon size={13} />
                    Reset settings
                  </button>
                </div>
              </div>
            </section>

            <section className="panel" id="export-panel" aria-labelledby="export-title">
              <div className="panel-head">
                <h2 id="export-title">Export</h2>
                <span className="panel-hint">Local FFmpeg</span>
              </div>
              <div className="panel-body">
                <div className="export-form">
                  <div>
                    <div className="format-grid" role="group" aria-label="Export format">
                      {[
                        { value: "mp4", label: "MP4", note: "Video" },
                        { value: "wav", label: "WAV", note: "Lossless" },
                        { value: "mp3", label: "MP3", note: "Audio" },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`format-option${format === option.value ? " is-active" : ""}`}
                          aria-pressed={format === option.value}
                          onClick={() =>
                            setFormat(option.value as "mp4" | "wav" | "mp3")
                          }
                        >
                          <span>{option.label}</span>
                          <span className="format-note">{option.note}</span>
                        </button>
                      ))}
                    </div>
                    <p className="settings-note" style={{ marginTop: 8 }}>
                      {format === "mp4"
                        ? "Keeps the source video and replaces the audio with your ducked mix."
                        : "Renders the ducked audio only, ready for your own video edit."}
                    </p>
                  </div>

                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={normalize}
                      onChange={(event) => setNormalize(event.target.checked)}
                    />
                    <span>
                      Normalize loudness
                      <span className="checkbox-hint">
                        EBU R128, −16 LUFS with a −1.5 dBTP ceiling.
                      </span>
                    </span>
                  </label>

                  <button
                    type="button"
                    className="button primary wide"
                    onClick={() => void handleExport()}
                    disabled={exportStarting || jobActive}
                  >
                    {exportStarting
                      ? "Starting render…"
                      : jobActive
                        ? "Rendering…"
                        : `Render ${format.toUpperCase()}`}
                    <ArrowRightIcon size={16} />
                  </button>

                  {exportError && (
                    <div className="export-error" role="alert">
                      {exportError}
                    </div>
                  )}

                  {exportJob && (
                    <div className="export-status" aria-live="polite">
                      <div className="export-status-head">
                        <span className="status-label">
                          {exportJob.status === "completed"
                            ? "Render complete"
                            : exportJob.status === "failed"
                              ? "Render failed"
                              : exportJob.status === "cancelled"
                                ? "Render cancelled"
                                : exportJob.stage}
                        </span>
                        <span className="status-percent">
                          {Math.round(exportJob.progress)}%
                        </span>
                      </div>
                      <div className="progress-track" aria-hidden="true">
                        <span style={{ width: `${exportJob.progress}%` }} />
                      </div>
                      <div className="export-stage">
                        {exportJob.status === "completed"
                          ? "Your file is ready to download."
                          : exportJob.status === "failed"
                            ? exportJob.error || "The render failed."
                            : exportJob.status === "cancelled"
                              ? "The render was cancelled."
                              : "Keep this tab open while the render runs."}
                      </div>

                      {jobActive && (
                        <button
                          type="button"
                          className="button quiet small wide"
                          style={{ marginTop: 10 }}
                          onClick={() => void handleCancelExport()}
                        >
                          <CloseIcon size={14} />
                          Cancel render
                        </button>
                      )}

                      {activeExport && (
                        <div className="download-card">
                          <span className="download-icon">
                            <DownloadIcon size={15} />
                          </span>
                          <span className="download-copy">
                            <span className="download-name">
                              {activeExport.filename}
                            </span>
                            <span className="download-meta">
                              {formatBytes(activeExport.size)} ·{" "}
                              {activeExport.format.toUpperCase()}
                              {activeExport.normalize ? " · normalized" : ""}
                            </span>
                          </span>
                          <a
                            className="download-link"
                            href={activeExport.downloadUrl}
                            download
                          >
                            Download
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="panel project-panel" aria-labelledby="project-title">
              <div className="panel-head">
                <h2 id="project-title">Project</h2>
                <span className="local-chip">
                  <LockIcon size={12} />
                  Local
                </span>
              </div>
              <div className="panel-body">
                <div className="meta-list">
                  <div className="meta-row">
                    <span className="meta-key">Duration</span>
                    <span className="meta-value">{formatDuration(duration)}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-key">Speech regions</span>
                    <span className="meta-value">
                      {audibleCount} active
                      {segments.length !== audibleCount
                        ? ` · ${segments.length - audibleCount} muted`
                        : ""}
                    </span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-key">Speech time</span>
                    <span className="meta-value">{formatDuration(speechDuration)}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-key">Detection</span>
                    <span className="meta-value">{engineLabel(project.vadEngine)}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-key">Video</span>
                    <span className="meta-value" title={video.originalName}>
                      {video.originalName}
                    </span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-key">Music</span>
                    <span className="meta-value" title={project.source.music.originalName}>
                      {project.source.music.originalName}
                    </span>
                  </div>
                  {project.source.voice && (
                    <div className="meta-row">
                      <span className="meta-key">Voiceover</span>
                      <span className="meta-value" title={project.source.voice.originalName}>
                        {project.source.voice.originalName}
                      </span>
                    </div>
                  )}
                </div>

                {previousExports.length > 0 && (
                  <div className="previous-exports">
                    <h3>Previous exports</h3>
                    {previousExports.slice(0, 4).map((entry) => (
                      <div className="previous-export" key={entry.id}>
                        <span className="export-name" title={entry.filename}>
                          {entry.filename}
                        </span>
                        <a href={entry.downloadUrl} download>
                          {formatBytes(entry.size)} · {formatDate(entry.createdAt)}
                        </a>
                      </div>
                    ))}
                  </div>
                )}

                <p className="settings-note" style={{ marginTop: 12 }}>
                  This mix and its renders stay in the local project folder. Use
                  Download to save a copy outside AudioDuck Studio.
                </p>
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  display,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  hint?: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const percent = ((value - min) / (max - min)) * 100;
  const fill = clamp(percent, 0, 100);

  return (
    <div className="slider-field">
      <div className="slider-top">
        <label htmlFor={id}>{label}</label>
        <span className="slider-value">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-valuetext={display}
      />
      {hint && <span className="slider-hint">{hint}</span>}
    </div>
  );
}

function RegionInspector({
  segment,
  duration,
  onChange,
  onRemove,
}: {
  segment: Segment;
  duration: number;
  onChange: (id: string, start: number, end: number) => void;
  onRemove: () => void;
}) {
  const [startDraft, setStartDraft] = useState(segment.start.toFixed(2));
  const [endDraft, setEndDraft] = useState(segment.end.toFixed(2));
  const startId = useId();
  const endId = useId();

  useEffect(() => {
    setStartDraft(segment.start.toFixed(2));
    setEndDraft(segment.end.toFixed(2));
  }, [segment.id, segment.start, segment.end]);

  const commit = () => {
    const start = Number(startDraft);
    const end = Number(endDraft);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      setStartDraft(segment.start.toFixed(2));
      setEndDraft(segment.end.toFixed(2));
      return;
    }
    const safeStart = clamp(start, 0, duration - 0.05);
    const safeEnd = clamp(end, safeStart + 0.05, duration);
    setStartDraft(safeStart.toFixed(2));
    setEndDraft(safeEnd.toFixed(2));
    onChange(segment.id, safeStart, safeEnd);
  };

  return (
    <div className="region-inspector">
      <div className="inspector-title">
        Selected
        <span className={`region-source${segment.source === "manual" ? " manual" : ""}`}>
          {segment.source === "manual" ? "Edited" : "Detected"}
        </span>
      </div>
      <div className="field">
        <label htmlFor={startId}>Start</label>
        <input
          id={startId}
          type="number"
          min={0}
          max={Math.max(0, segment.end - 0.05)}
          step={0.1}
          value={startDraft}
          onChange={(event) => setStartDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              setStartDraft(segment.start.toFixed(2));
              setEndDraft(segment.end.toFixed(2));
              event.currentTarget.blur();
            }
          }}
        />
      </div>
      <div className="field">
        <label htmlFor={endId}>End</label>
        <input
          id={endId}
          type="number"
          min={segment.start + 0.05}
          max={duration}
          step={0.1}
          value={endDraft}
          onChange={(event) => setEndDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              setStartDraft(segment.start.toFixed(2));
              setEndDraft(segment.end.toFixed(2));
              event.currentTarget.blur();
            }
          }}
        />
      </div>
      <button
        type="button"
        className="region-remove"
        onClick={onRemove}
        aria-label="Remove selected region"
        title="Remove region"
      >
        <TrashIcon size={15} />
      </button>
    </div>
  );
}
