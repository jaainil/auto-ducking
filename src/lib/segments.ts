import {
  reconcileSegments,
  segmentsFromProbabilities,
} from "../../shared/envelope.js";
import type { Project, Segment } from "../types";

let manualCounter = 0;

function manualId() {
  manualCounter += 1;
  return `m_${Date.now().toString(36)}_${manualCounter}`;
}

export function resegment(
  project: Project,
  threshold: number,
  minSilenceMs: number,
): Segment[] {
  const detected = segmentsFromProbabilities(
    project.vad.probabilities,
    project.vad.hopMs,
    {
      threshold,
      minSilenceMs,
      minSpeechMs: project.settings.minSpeechMs,
      padMs: project.settings.padMs,
    },
  );
  return reconcileSegments(detected, project.segments) as Segment[];
}

export function resetToDetection(project: Project): Segment[] {
  return project.detected.map((segment, index) => ({
    id: `v_reset_${index}_${Math.round(segment.start * 1000)}`,
    start: segment.start,
    end: segment.end,
    source: "vad" as const,
    enabled: true,
  }));
}

export function addRegion(
  segments: Segment[],
  start: number,
  end: number,
): Segment[] {
  const region: Segment = {
    id: manualId(),
    start: Math.round(start * 1000) / 1000,
    end: Math.round(end * 1000) / 1000,
    source: "manual",
    enabled: true,
  };
  return [...segments, region].sort((a, b) => a.start - b.start);
}

export function updateRegion(
  segments: Segment[],
  id: string,
  next: { start: number; end: number },
): Segment[] {
  return segments.map((segment) =>
    segment.id === id
      ? {
          ...segment,
          start: Math.round(next.start * 1000) / 1000,
          end: Math.round(next.end * 1000) / 1000,
          source: "manual",
        }
      : segment,
  );
}

export function removeRegion(segments: Segment[], id: string): Segment[] {
  return segments
    .map((segment) =>
      segment.id === id && segment.source === "vad"
        ? { ...segment, enabled: false }
        : segment,
    )
    .filter((segment) => !(segment.id === id && segment.source === "manual"));
}

export function toggleRegion(segments: Segment[], id: string): Segment[] {
  return segments.map((segment) =>
    segment.id === id ? { ...segment, enabled: !segment.enabled } : segment,
  );
}

export function audibleSegments(segments: Segment[]) {
  return segments.filter((segment) => segment.enabled !== false);
}

export function regionsAt(segments: Segment[], time: number) {
  return segments.filter(
    (segment) => time >= segment.start && time <= segment.end,
  );
}
