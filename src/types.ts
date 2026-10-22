export type SegmentSource = "vad" | "manual";

export interface Segment {
  id: string;
  start: number;
  end: number;
  source: SegmentSource;
  enabled: boolean;
}

export interface DuckingSettings {
  reductionDb: number;
  baseMusicDb: number;
  lookAheadMs: number;
  fadeDownMs: number;
  holdMs: number;
  releaseMs: number;
  threshold: number;
  minSpeechMs: number;
  minSilenceMs: number;
  padMs: number;
  musicStartSeconds: number;
  musicEndSeconds: number;
}

export interface VadData {
  engine: "silero" | "energy" | string;
  hopMs: number;
  probabilities: number[];
}

export interface ProjectSource {
  video: {
    originalName: string;
    stored: string;
    size: number;
    width: number | null;
    height: number | null;
    codec: string | null;
    hasAudio: boolean;
  };
  music: {
    originalName: string;
    stored: string;
    size: number;
    duration: number;
  };
  voice: {
    originalName: string;
    stored: string;
    duration: number;
  } | null;
}

export interface ProjectAnalysis {
  engine: "silero" | "energy" | string;
  analyzedAt: string;
  speechCount: number;
  speechDuration: number;
}

export interface ExportRecord {
  id: string;
  file: string;
  filename: string;
  format: "mp4" | "wav" | "mp3";
  size: number;
  duration: number;
  normalize: boolean;
  createdAt: string;
  downloadUrl: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  duration: number;
  source: ProjectSource;
  media: {
    video: string;
    voiceWav: string;
    voicePreview: string;
    music: string;
  };
  mediaUrls: {
    video: string;
    voicePreview: string;
    music: string;
  };
  settings: DuckingSettings;
  detected: Array<{ start: number; end: number }>;
  segments: Segment[];
  analysis: ProjectAnalysis;
  vadEngine: string;
  vad: VadData;
  exports: ExportRecord[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  duration: number;
  createdAt: string;
  updatedAt: string;
  width: number | null;
  height: number | null;
  speechCount: number;
  vadEngine: string | null;
}

export interface UploadResult {
  uploadId: string;
  filename: string;
  size: number;
  duration: number;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
}

export type JobStatus =
  | "queued"
  | "rendering"
  | "completed"
  | "failed"
  | "cancelled";

export interface RenderJob {
  id: string;
  projectId: string;
  format: "mp4" | "wav" | "mp3";
  normalize: boolean;
  status: JobStatus;
  stage: string;
  progress: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  output: {
    file: string;
    filename: string;
    size: number;
    duration: number;
    format: string;
    normalize: boolean;
    createdAt: string;
    downloadUrl: string;
  } | null;
  error: string | null;
}

export interface PeakData {
  min: Float32Array;
  max: Float32Array;
}

export interface Peaks {
  voice: PeakData;
  music: PeakData;
  buckets: number;
}
