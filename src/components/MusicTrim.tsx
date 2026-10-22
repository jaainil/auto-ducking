import { useMemo, useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { PeakData } from "../types";
import { formatTimecode } from "../lib/format";

interface Props {
  start: number;
  end: number;
  duration: number;
  videoDuration: number;
  peaks: PeakData | null;
  filename: string;
  loading: boolean;
  onChange: (start: number, end: number) => void;
}

export function MusicTrim({ start, end, duration, videoDuration, peaks, filename, loading, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const minLength = Math.min(.05, duration);
  const safeDuration = duration || 1;
  const selected = end - start;
  const wave = useMemo(() => {
    if (!peaks) return [];
    let maximum = .001;
    for (let i = 0; i < peaks.max.length; i++) maximum = Math.max(maximum, Math.abs(peaks.min[i]), peaks.max[i]);
    return Array.from({ length: 420 }, (_, index) => {
      const bucket = Math.floor(index / 420 * peaks.max.length);
      return { x: index / 419 * 1000, top: 44 - Math.max(1, peaks.max[bucket] / maximum * 29), bottom: 44 + Math.max(1, -peaks.min[bucket] / maximum * 29) };
    });
  }, [peaks]);

  const change = (edge: "start" | "end", value: number) => {
    if (!Number.isFinite(value) || duration <= 0) return;
    if (edge === "start") onChange(Math.max(0, Math.min(end - minLength, value)), end);
    else onChange(start, Math.max(start + minLength, Math.min(duration, value)));
  };
  const drag = (edge: "start" | "end", event: PointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (rect) change(edge, (event.clientX - rect.left) / rect.width * duration);
  };
  const keyboard = (edge: "start" | "end", event: KeyboardEvent<HTMLButtonElement>) => {
    const value = edge === "start" ? start : end;
    const step = event.shiftKey ? 1 : .1;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); change(edge, value - step); }
    if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); change(edge, value + step); }
    if (event.key === "Home") { event.preventDefault(); change(edge, edge === "start" ? 0 : start + minLength); }
    if (event.key === "End") { event.preventDefault(); change(edge, edge === "end" ? duration : end - minLength); }
  };

  return <section className="music-trim" aria-labelledby="music-trim-title">
    <div className="music-trim-heading">
      <div><h2 id="music-trim-title">Trim music</h2><p title={filename}>{filename}</p></div>
      <button type="button" className="text-button" disabled={loading} onClick={() => onChange(0, duration)}>Use full track</button>
    </div>
    <p className="music-trim-help">Choose the part of the song you want. We fit it to your video automatically.</p>
    <div className="music-trim-track" ref={trackRef} aria-busy={loading}>
      <svg viewBox="0 0 1000 88" preserveAspectRatio="none" aria-hidden="true">
        <rect width="1000" height="88" fill="#f5f8ff" />
        <g stroke="#7a9bf4" strokeWidth="1.8">{wave.map((bar, i) => <line key={i} x1={bar.x} x2={bar.x} y1={bar.top} y2={bar.bottom} />)}</g>
        <rect x="0" y="0" width={start / safeDuration * 1000} height="88" fill="#ffffff" opacity=".8" />
        <rect x={end / safeDuration * 1000} y="0" width={(duration - end) / safeDuration * 1000} height="88" fill="#ffffff" opacity=".8" />
        <rect x={start / safeDuration * 1000} y="1" width={selected / safeDuration * 1000} height="86" fill="none" stroke="#2563eb" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      {(["start", "end"] as const).map(edge => <button key={edge} type="button" role="slider" className={`music-trim-handle ${edge}`} disabled={loading} aria-label={`Music trim ${edge}`} aria-valuemin={edge === "start" ? 0 : start + minLength} aria-valuemax={edge === "start" ? end - minLength : duration} aria-valuenow={edge === "start" ? start : end} aria-valuetext={formatTimecode(edge === "start" ? start : end, true)} style={{left:`${(edge === "start" ? start : end) / safeDuration * 100}%`}} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => drag(edge, event)} onKeyDown={event => keyboard(edge, event)}><span aria-hidden="true" /></button>)}
      {loading && <span className="music-trim-loading">Loading waveform…</span>}
    </div>
    <div className="music-trim-ruler"><span>0:00</span><span>{formatTimecode(duration)}</span></div>
    <div className="music-trim-controls">
      <label>Start <span>(seconds)</span><input type="number" min="0" max={Math.max(0,end-minLength)} step="0.1" value={Number(start.toFixed(3))} disabled={loading} onChange={event => {if(event.target.value !== "") change("start", event.target.valueAsNumber);}} /></label>
      <label>End <span>(seconds)</span><input type="number" min={start+minLength} max={duration} step="0.1" value={Number(end.toFixed(3))} disabled={loading} onChange={event => {if(event.target.value !== "") change("end", event.target.valueAsNumber);}} /></label>
      <button type="button" className="button secondary small" disabled={loading} onClick={() => onChange(start, Math.min(duration, start + videoDuration))}>Match video length</button>
    </div>
    <p className="music-trim-summary" role="status"><strong>{selected.toFixed(1)}s selected</strong><span>{selected < videoDuration - .01 ? `Loops to fill your ${formatTimecode(videoDuration)} video.` : `Cuts to your ${formatTimecode(videoDuration)} video.`} Original speed and pitch.</span></p>
  </section>;
}
