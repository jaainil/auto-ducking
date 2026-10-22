import { useMemo } from "react";
import { buildEnvelope, DEFAULT_SETTINGS } from "../../shared/envelope.js";
import { formatTimecode } from "../lib/format";

const WIDTH = 560;
const HEIGHT = 228;
const LEFT = 82;
const RIGHT = 18;
const TOP = 28;
const VOICE_TOP = 34;
const VOICE_HEIGHT = 62;
const MUSIC_TOP = 112;
const MUSIC_HEIGHT = 62;
const DURATION = 28;

const spans = [
  { start: 1.8, end: 6.4 },
  { start: 7.3, end: 11.6 },
  { start: 12.8, end: 17.1 },
  { start: 18.4, end: 21.8 },
  { start: 23.1, end: 26.4 },
];

const plotWidth = WIDTH - LEFT - RIGHT;
const xFor = (time: number) => LEFT + (time / DURATION) * plotWidth;

function pulse(index: number, seed: number) {
  const raw =
    Math.sin(index * 1.71 + seed) * 0.46 +
    Math.sin(index * 4.31 + seed * 2.3) * 0.3 +
    Math.sin(index * 8.17 + seed * 0.7) * 0.18;
  return Math.abs(raw) + 0.08;
}

function insideSpeech(time: number) {
  return spans.some((span) => time >= span.start && time <= span.end);
}

export function DuckingDiagram() {
  const envelope = useMemo(
    () =>
      buildEnvelope(spans, {
        ...DEFAULT_SETTINGS,
        reductionDb: 12,
        baseMusicDb: 0,
        holdMs: 180,
        releaseMs: 420,
      }, DURATION, 30),
    [],
  );

  const bars = 118;
  const barWidth = plotWidth / bars;
  const voiceBars = Array.from({ length: bars }, (_, index) => {
    const time = (index / bars) * DURATION;
    const height = insideSpeech(time)
      ? pulse(index, 1.4) * (VOICE_HEIGHT / 2 - 5)
      : 0.9;
    return {
      x: LEFT + index * barWidth + barWidth / 2,
      y: VOICE_TOP + VOICE_HEIGHT / 2,
      height,
    };
  });

  const musicBars = Array.from({ length: bars }, (_, index) => {
    const time = (index / bars) * DURATION;
    const height = pulse(index, 4.2) * (MUSIC_HEIGHT / 2 - 8);
    return {
      x: LEFT + index * barWidth + barWidth / 2,
      y: MUSIC_TOP + MUSIC_HEIGHT / 2,
      height,
      ducked: insideSpeech(time),
    };
  });

  const curvePoints = Array.from(envelope).map((gain, index) => {
    const x = LEFT + (index / (envelope.length - 1)) * plotWidth;
    const y = MUSIC_TOP + MUSIC_HEIGHT - 5 - gain * (MUSIC_HEIGHT - 10);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <figure className="diagram">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Diagram of speech-aware music ducking: five speech regions lower the music by 12 decibels with smooth fades."
      >
        <g className="diagram-ruler">
          {[0, 7, 14, 21, 28].map((time) => (
            <g key={time}>
              <line
                x1={xFor(time)}
                y1={TOP - 8}
                x2={xFor(time)}
                y2={HEIGHT - 8}
                stroke="var(--line)"
                strokeWidth="1"
                strokeDasharray="2 5"
              />
              <text x={xFor(time)} y={TOP - 14} textAnchor="middle">
                {formatTimecode(time)}
              </text>
            </g>
          ))}
        </g>

        {spans.map((span) => (
          <g key={span.start}>
            <rect
              x={xFor(span.start)}
              y={VOICE_TOP - 5}
              width={xFor(span.end) - xFor(span.start)}
              height={MUSIC_TOP + MUSIC_HEIGHT - VOICE_TOP + 10}
              rx="2"
              fill="rgba(37, 99, 235, 0.055)"
            />
            <line
              x1={xFor(span.start)}
              x2={xFor(span.end)}
              y1={VOICE_TOP - 5}
              y2={VOICE_TOP - 5}
              stroke="rgba(37, 99, 235, 0.45)"
              strokeWidth="1"
            />
            <line
              x1={xFor(span.start)}
              x2={xFor(span.end)}
              y1={VOICE_TOP + VOICE_HEIGHT + 5}
              y2={VOICE_TOP + VOICE_HEIGHT + 5}
              stroke="rgba(37, 99, 235, 0.32)"
              strokeWidth="1"
            />
          </g>
        ))}

        {voiceBars.map((bar, index) => (
          <line
            key={`v-${index}`}
            x1={bar.x}
            x2={bar.x}
            y1={bar.y - bar.height}
            y2={bar.y + bar.height}
            stroke="#111"
            strokeOpacity={bar.height > 2 ? 0.52 : 0.16}
            strokeWidth={Math.max(1, barWidth * 0.62)}
            strokeLinecap="round"
          />
        ))}

        {musicBars.map((bar, index) => (
          <line
            key={`m-${index}`}
            x1={bar.x}
            x2={bar.x}
            y1={bar.y - bar.height}
            y2={bar.y + bar.height}
            stroke={bar.ducked ? "rgba(37, 99, 235, 0.52)" : "#4D4D4D"}
            strokeOpacity={bar.ducked ? 0.5 : 0.34}
            strokeWidth={Math.max(1, barWidth * 0.62)}
            strokeLinecap="round"
          />
        ))}

        <polyline
          points={curvePoints.join(" ")}
          fill="none"
          stroke="#2563EB"
          strokeWidth="2.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        <line
          x1={LEFT}
          x2={WIDTH - RIGHT}
          y1={MUSIC_TOP + 1}
          y2={MUSIC_TOP + 1}
          stroke="var(--line)"
        />
        <line
          x1={LEFT}
          x2={WIDTH - RIGHT}
          y1={VOICE_TOP - 4}
          y2={VOICE_TOP - 4}
          stroke="var(--line)"
        />

        <g className="diagram-labels">
          <text x="0" y={VOICE_TOP + 17}>
            Voiceover
          </text>
          <text x="0" y={VOICE_TOP + 33} className="diagram-meta">
            5 regions
          </text>
          <text x="0" y={MUSIC_TOP + 17}>
            Music
          </text>
          <text x="0" y={MUSIC_TOP + 33} className="diagram-meta">
            −12 dB duck
          </text>
        </g>

        <g transform={`translate(${xFor(13.9) - 34}, ${MUSIC_TOP + MUSIC_HEIGHT + 19})`}>
          <rect width="68" height="20" rx="10" fill="#EAF1FF" />
          <text
            x="34"
            y="13.5"
            textAnchor="middle"
            fill="#2563EB"
            className="diagram-pill"
          >
            −12 dB
          </text>
        </g>
      </svg>
      <figcaption>
        Speech detected · music eased down 12 dB with 120 ms fades and a
        500 ms recovery.
      </figcaption>
    </figure>
  );
}
