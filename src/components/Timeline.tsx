import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { buildEnvelope, envelopeAt } from "../../shared/envelope.js";
import { musicFadeAt } from "../../shared/music.js";
import type { DuckingSettings, Peaks, Segment } from "../types";
import { clamp, formatRegion, formatTimecode } from "../lib/format";

const ENVELOPE_RATE = 200;

function tickInterval(duration: number) {
  const target = duration / 7;
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300];
  return steps.find((step) => step >= target) ?? 300;
}

export function timelineTicks(duration: number) {
  const step = tickInterval(duration);
  const ticks: number[] = [];
  for (let time = 0; time <= duration + 0.001; time += step) {
    ticks.push(Math.round(time * 1000) / 1000);
  }
  if (ticks.at(-1) !== duration) {
    ticks.push(duration);
  }
  return ticks;
}

function drawTimeline(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  peaks: Peaks | null,
  envelope: Float32Array,
  duration: number,
) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(width * ratio));
  canvas.height = Math.max(1, Math.floor(height * ratio));
  const context = canvas.getContext("2d");
  if (!context) return;

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const voiceCenter = 56;
  const voiceAmp = 30;
  const musicCenter = 142;
  const musicAmp = 25;
  const curveTop = 104;
  const curveBottom = 168;
  const tick = tickInterval(duration);

  context.save();
  context.strokeStyle = "rgba(0, 0, 0, 0.055)";
  context.lineWidth = 1;
  for (let time = 0; time <= duration + 0.001; time += tick) {
    const x = (time / duration) * width;
    context.beginPath();
    context.moveTo(x, 16);
    context.lineTo(x, height - 4);
    context.stroke();
  }
  context.restore();

  context.save();
  context.strokeStyle = "rgba(0, 0, 0, 0.08)";
  context.beginPath();
  context.moveTo(0, 96);
  context.lineTo(width, 96);
  context.moveTo(0, 104);
  context.lineTo(width, 104);
  context.stroke();
  context.restore();

  const columns = Math.max(1, Math.floor(width));

  if (peaks) {
    context.save();
    for (let column = 0; column < columns; column += 1) {
      const x = column + 0.5;
      const bucket = Math.min(
        peaks.buckets - 1,
        Math.max(0, Math.floor((column / columns) * peaks.buckets)),
      );
      const voiceMin = peaks.voice.min[bucket] ?? 0;
      const voiceMax = peaks.voice.max[bucket] ?? 0;
      const time = (column / columns) * duration;
      const gain = envelopeAt(envelope, ENVELOPE_RATE, time);
      const musicMin = (peaks.music.min[bucket] ?? 0) * gain;
      const musicMax = (peaks.music.max[bucket] ?? 0) * gain;

      context.strokeStyle = "rgba(17, 17, 17, 0.42)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, voiceCenter - voiceMax * voiceAmp);
      context.lineTo(x, voiceCenter - voiceMin * voiceAmp);
      context.stroke();

      context.strokeStyle =
        gain < 0.985
          ? "rgba(37, 99, 235, 0.56)"
          : "rgba(77, 77, 77, 0.32)";
      context.beginPath();
      context.moveTo(x, musicCenter - musicMax * musicAmp);
      context.lineTo(x, musicCenter - musicMin * musicAmp);
      context.stroke();
    }
    context.restore();
  } else {
    context.save();
    context.strokeStyle = "rgba(17, 17, 17, 0.2)";
    context.beginPath();
    context.moveTo(0, voiceCenter);
    context.lineTo(width, voiceCenter);
    context.stroke();
    context.strokeStyle = "rgba(77, 77, 77, 0.16)";
    context.beginPath();
    context.moveTo(0, musicCenter);
    context.lineTo(width, musicCenter);
    context.stroke();
    context.restore();
  }

  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";
  context.strokeStyle = "rgba(255, 255, 255, 0.9)";
  context.lineWidth = 4.5;
  context.beginPath();
  for (let column = 0; column < columns; column += 2) {
    const time = (column / columns) * duration;
    const gain = envelopeAt(envelope, ENVELOPE_RATE, time);
    const x = column + 0.5;
    const y = curveTop + (1 - gain) * (curveBottom - curveTop);
    if (column === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();

  context.strokeStyle = "#2563EB";
  context.lineWidth = 2;
  context.beginPath();
  for (let column = 0; column < columns; column += 2) {
    const time = (column / columns) * duration;
    const gain = envelopeAt(envelope, ENVELOPE_RATE, time);
    const x = column + 0.5;
    const y = curveTop + (1 - gain) * (curveBottom - curveTop);
    if (column === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  context.restore();
}

interface DragState {
  id: string;
  mode: "move" | "start" | "end";
  originX: number;
  start: number;
  end: number;
  moved: boolean;
  pointerId: number;
}

export function Timeline({
  duration,
  segments,
  settings,
  duckingEnvelope,
  peaks,
  currentTime,
  selectedId,
  onSelect,
  onSeek,
  onUpdateSegment,
  loading,
  error,
}: {
  duration: number;
  segments: Segment[];
  settings: DuckingSettings;
  duckingEnvelope?: Float32Array;
  peaks: Peaks | null;
  currentTime: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSeek: (time: number) => void;
  onUpdateSegment: (id: string, start: number, end: number) => void;
  loading?: boolean;
  error?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 188 });
  const dragRef = useRef<DragState | null>(null);
  const justDraggedRef = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const envelope = useMemo(
    () => {
      const curve = duckingEnvelope ? new Float32Array(duckingEnvelope) : buildEnvelope(segments, settings, duration, ENVELOPE_RATE);
      for (let i = 0; i < curve.length; i++) curve[i] *= musicFadeAt(i / ENVELOPE_RATE, duration, settings);
      return curve;
    },
    [segments, settings, duration, duckingEnvelope],
  );

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const update = () => {
      setSize({
        width: wrap.clientWidth,
        height: wrap.clientHeight,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0) return;
    drawTimeline(canvas, size.width, size.height, peaks, envelope, duration);
  }, [size, peaks, envelope, duration]);

  const ticks = useMemo(() => timelineTicks(duration), [duration]);
  const timeFromClientX = (clientX: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return 0;
    const rect = wrap.getBoundingClientRect();
    return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration);
  };

  const beginDrag = (
    event: ReactPointerEvent<HTMLElement>,
    segment: Segment,
    mode: DragState["mode"],
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const wrap = wrapRef.current;
    if (!wrap) return;
    onSelect(segment.id);
    justDraggedRef.current = false;
    dragRef.current = {
      id: segment.id,
      mode,
      originX: event.clientX,
      start: segment.start,
      end: segment.end,
      moved: false,
      pointerId: event.pointerId,
    };
    setDraggingId(segment.id);
    wrap.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const wrap = wrapRef.current;
    if (!drag || !wrap) return;
    const dx = event.clientX - drag.originX;
    if (Math.abs(dx) > 2) drag.moved = true;
    const delta = (dx / Math.max(1, wrap.clientWidth)) * duration;
    let start = drag.start;
    let end = drag.end;

    if (drag.mode === "move") {
      const width = end - start;
      start = clamp(start + delta, 0, Math.max(0, duration - width));
      end = start + width;
    } else if (drag.mode === "start") {
      start = clamp(start + delta, 0, end - 0.05);
    } else {
      end = clamp(end + delta, start + 0.05, duration);
    }

    onUpdateSegment(drag.id, start, end);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const wrap = wrapRef.current;
    if (!drag) return;

    if (!drag.moved) {
      onSeek(drag.start);
    }

    justDraggedRef.current = true;
    window.setTimeout(() => {
      justDraggedRef.current = false;
    }, 90);

    dragRef.current = null;
    setDraggingId(null);
    if (wrap?.hasPointerCapture?.(event.pointerId)) {
      wrap.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className="timeline-shell">
      <div className="timeline-ruler" aria-hidden="true">
        {ticks.map((time, index) => (
          <span
            key={`${time}-${index}`}
            style={{
              left: `${(time / duration) * 100}%`,
            }}
          >
            {formatTimecode(time)}
          </span>
        ))}
      </div>

      <div
        ref={wrapRef}
        className="timeline-canvas-wrap"
        tabIndex={0}
        role="slider"
        aria-label="Project timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration * 10) / 10}
        aria-valuenow={Math.round(currentTime * 10) / 10}
        aria-valuetext={`${formatTimecode(currentTime, true)} of ${formatTimecode(duration)}`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const time = timeFromClientX(event.clientX);
          onSelect(null);
          onSeek(time);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            onSeek(Math.max(0, currentTime - 1));
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            onSeek(Math.min(duration, currentTime + 1));
          }
          if (event.key === "Home") {
            event.preventDefault();
            onSeek(0);
          }
          if (event.key === "End") {
            event.preventDefault();
            onSeek(duration);
          }
        }}
      >
        <canvas ref={canvasRef} aria-hidden="true" />

        {segments.map((segment) => {
          const left = (segment.start / duration) * 100;
          const width = Math.max(((segment.end - segment.start) / duration) * 100, 0.35);
          return (
            <button
              key={segment.id}
              type="button"
              className={[
                "timeline-region",
                segment.enabled === false ? "is-disabled" : "",
                segment.source === "manual" ? "is-manual" : "",
                selectedId === segment.id ? "is-selected" : "",
                draggingId === segment.id ? "is-dragging" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={formatRegion(segment.start, segment.end)}
              aria-label={`${segment.source === "manual" ? "Manual" : "Detected"} speech region, ${formatRegion(segment.start, segment.end)}${segment.enabled === false ? ", muted" : ""}. Click to play from here, drag to move.`}
              onPointerDown={(event) => beginDrag(event, segment, "move")}
              onClick={() => {
                if (justDraggedRef.current) {
                  justDraggedRef.current = false;
                  return;
                }
                onSelect(segment.id);
                onSeek(segment.start);
              }}
            >
              <span className="region-label">
                {formatTimecode(segment.start, true)}
              </span>
              <span
                className="region-handle start"
                onPointerDown={(event) => beginDrag(event, segment, "start")}
                aria-hidden="true"
              />
              <span
                className="region-handle end"
                onPointerDown={(event) => beginDrag(event, segment, "end")}
                aria-hidden="true"
              />
            </button>
          );
        })}

        <div
          className="timeline-playhead"
          style={{ left: `${(currentTime / duration) * 100}%` }}
          aria-hidden="true"
        />

        {loading && <div className="timeline-loading">Reading the audio…</div>}
        {error && <div className="timeline-loading is-error">{error}</div>}
      </div>

      <div className="timeline-legend">
        <span className="legend-item">
          <span className="legend-swatch voice" /> Voiceover
        </span>
        <span className="legend-item">
          <span className="legend-swatch music" /> Music
        </span>
        <span className="legend-item">
          <span className="legend-swatch" /> Ducking curve
        </span>
        <span className="legend-item">
          <span className="legend-swatch region" /> Speech region
        </span>
        <span className="legend-spacer" />
        <span>Drag a region to move it. Drag its edges to trim.</span>
      </div>
    </div>
  );
}
