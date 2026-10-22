/**
 * Shared ducking engine. Used by the browser preview and the server-side
 * FFmpeg render so both consume the exact same automation curve.
 *
 * @typedef {{ start: number, end: number, enabled?: boolean }} SpeechSegment
 * @typedef {{
 *   reductionDb: number,
 *   baseMusicDb: number,
 *   lookAheadMs: number,
 *   fadeDownMs: number,
 *   holdMs: number,
 *   releaseMs: number
 * }} DuckingSettings
 */

export const DEFAULT_SETTINGS = Object.freeze({
  reductionDb: 12,
  baseMusicDb: -12,
  lookAheadMs: 80,
  fadeDownMs: 120,
  holdMs: 200,
  releaseMs: 500,
  threshold: 0.5,
  minSpeechMs: 160,
  minSilenceMs: 240,
  padMs: 60,
  musicStartSeconds: 0,
  musicEndSeconds: 0,
});

export const LIMITS = Object.freeze({
  maxDurationSeconds: 600,
  maxFileBytes: 250 * 1024 * 1024,
  envelopeRate: 200,
  renderEnvelopeRate: 1000,
});

/**
 * Convert a decibel change to a linear amplitude multiplier.
 * @param {number} db
 */
export function dbToGain(db) {
  return 10 ** (Number(db) / 20);
}

/** @param {number} value @param {number} min @param {number} max */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Smoothstep easing on a 0..1 ramp. Applying this to the duck factor keeps
 * the fade smooth in the decibel domain, not just in linear amplitude.
 * @param {number} x
 */
export function smoothstep(x) {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * @param {SpeechSegment[]} segments
 * @param {number} duration
 */
export function sanitizeSegments(segments, duration = Infinity) {
  if (!Array.isArray(segments)) return [];
  return segments
    .filter(
      (segment) =>
        segment &&
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        segment.end > segment.start,
    )
    .map((segment) => ({
      start: clamp(segment.start, 0, duration),
      end: clamp(segment.end, 0, duration),
      enabled: segment.enabled !== false,
    }))
    .filter((segment) => segment.end - segment.start > 0.001)
    .sort((a, b) => a.start - b.start);
}

/**
 * Join regions whose envelopes would overlap. This is what stops the music
 * pumping between short pauses inside a sentence.
 *
 * @param {SpeechSegment[]} segments
 * @param {number} mergeGapSeconds
 * @param {number} duration
 */
export function mergeSpeechSegments(segments, mergeGapSeconds, duration = Infinity) {
  const sorted = sanitizeSegments(segments, duration);
  /** @type {SpeechSegment[]} */
  const merged = [];

  for (const segment of sorted) {
    const last = merged[merged.length - 1];
    if (last && segment.start - last.end <= mergeGapSeconds) {
      last.end = Math.max(last.end, segment.end);
      last.enabled = Boolean(last.enabled || segment.enabled);
    } else {
      merged.push({ ...segment });
    }
  }

  return merged;
}

/**
 * Build the music gain multiplier curve. 1 = full music, 10^(-reduction/20)
 * = fully ducked. Values are pure multipliers; base music level is applied
 * separately by the player and the renderer.
 *
 * @param {SpeechSegment[]} segments
 * @param {DuckingSettings} settings
 * @param {number} duration seconds
 * @param {number} [rate] samples per second
 * @returns {Float32Array}
 */
export function buildEnvelope(segments, settings, duration, rate = LIMITS.envelopeRate) {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("A positive project duration is required");
  }

  const lookAhead = clamp(Number(settings.lookAheadMs) || 0, 0, 2000) / 1000;
  const fadeDown = clamp(Number(settings.fadeDownMs) || 0, 1, 5000) / 1000;
  const hold = clamp(Number(settings.holdMs) || 0, 0, 10000) / 1000;
  const release = clamp(Number(settings.releaseMs) || 0, 1, 10000) / 1000;
  const reductionDb = clamp(Number(settings.reductionDb) || 0, 0, 60);
  const mergeGap = lookAhead + fadeDown + hold + release;

  const merged = mergeSpeechSegments(
    (segments || []).filter((segment) => segment.enabled !== false),
    mergeGap,
    duration,
  );

  const regions = merged.map((segment) => ({
    fadeStart: Math.max(-1, segment.start - lookAhead - fadeDown),
    fadeEnd: segment.start - lookAhead,
    recoverStart: segment.end + hold,
    recoverEnd: segment.end + hold + release,
  }));

  const frames = Math.max(1, Math.ceil(duration * rate));
  const envelope = new Float32Array(frames);

  let regionIndex = 0;

  for (let i = 0; i < frames; i += 1) {
    const t = i / rate;

    while (
      regionIndex < regions.length &&
      t >= regions[regionIndex].recoverEnd
    ) {
      regionIndex += 1;
    }

    let duck = 0;
    const region = regions[regionIndex];

    if (region) {
      if (t >= region.fadeStart && t < region.fadeEnd) {
        duck = smoothstep((t - region.fadeStart) / fadeDown);
      } else if (t >= region.fadeEnd && t < region.recoverStart) {
        duck = 1;
      } else if (t >= region.recoverStart && t < region.recoverEnd) {
        duck = 1 - smoothstep((t - region.recoverStart) / release);
      }
    }

    envelope[i] = dbToGain(-reductionDb * duck);
  }

  return envelope;
}

/**
 * @param {Float32Array} envelope
 * @param {number} rate
 * @param {number} time seconds
 */
export function envelopeAt(envelope, rate, time) {
  if (!envelope.length) return 1;
  const index = clamp(Math.round(time * rate), 0, envelope.length - 1);
  return envelope[index];
}

/**
 * Merge detected speech into the final editable segment list while keeping
 * user-created regions and deliberate deletions.
 *
 * @param {SpeechSegment[]} detected
 * @param {SpeechSegment[]} previous
 * @param {{ start: number, end: number }} [newRegion]
 */
export function reconcileSegments(detected, previous = [], newRegion = null) {
  const userId = () => `m_${Math.random().toString(36).slice(2, 9)}`;
  const wasDeleted = previous.filter(
    (segment) => segment.source === "vad" && segment.enabled === false,
  );
  const manual = previous.filter((segment) => segment.source === "manual");

  // Detected regions that overlap a manually deleted region stay deleted.
  const nextAuto = detected.map((segment) => {
    const deleted = wasDeleted.some(
      (gone) =>
        Math.min(gone.end, segment.end) - Math.max(gone.start, segment.start) > 0,
    );
    return {
      id: `v_${segment.start.toFixed(3)}_${segment.end.toFixed(3)}`,
      start: segment.start,
      end: segment.end,
      source: "vad",
      enabled: !deleted,
    };
  });

  const manualList = [
    ...manual,
    ...(newRegion
      ? [
          {
            id: userId(),
            start: newRegion.start,
            end: newRegion.end,
            source: "manual",
            enabled: true,
          },
        ]
      : []),
  ];

  // A manual region is an override: never stack an automatic region on top of it.
  const autoKept = nextAuto.filter((segment) => {
    if (!segment.enabled) return true;
    return !manualList.some(
      (region) =>
        Math.min(region.end, segment.end) - Math.max(region.start, segment.start) >
        0.02,
    );
  });

  return [...autoKept, ...manualList]
    .sort((a, b) => a.start - b.start)
    .filter((segment, index, list) => {
      if (index === 0) return true;
      const prev = list[index - 1];
      return !(
        prev.source === "manual" &&
        segment.source === "manual" &&
        Math.abs(prev.start - segment.start) < 0.002 &&
        Math.abs(prev.end - segment.end) < 0.002
      );
    });
}

/**
 * Turn frame probabilities into speech intervals.
 *
 * @param {number[]|Float32Array} probabilities
 * @param {number} hopMs
 * @param {{ threshold?: number, minSpeechMs?: number, minSilenceMs?: number, padMs?: number }} [options]
 */
export function segmentsFromProbabilities(probabilities, hopMs, options = {}) {
  const threshold = clamp(Number(options.threshold ?? 0.5), 0.05, 0.95);
  const releaseThreshold = Math.max(0.05, threshold - 0.18);
  const minSpeechMs = clamp(Number(options.minSpeechMs ?? 160), 30, 3000);
  const minSilenceMs = clamp(Number(options.minSilenceMs ?? 240), 30, 5000);
  const padMs = clamp(Number(options.padMs ?? 60), 0, 500);
  const totalDuration = (probabilities.length * hopMs) / 1000;

  /** @type {{ start: number, end: number }[]} */
  const raw = [];
  let active = false;
  let startFrame = 0;
  let lastVoiceFrame = 0;

  for (let i = 0; i < probabilities.length; i += 1) {
    const probability = probabilities[i];

    if (!active) {
      if (probability >= threshold) {
        active = true;
        startFrame = i;
        lastVoiceFrame = i;
      }
      continue;
    }

    if (probability >= releaseThreshold) {
      lastVoiceFrame = i;
    }

    if ((i - lastVoiceFrame) * hopMs >= minSilenceMs) {
      raw.push({
        start: (startFrame * hopMs) / 1000,
        end: ((lastVoiceFrame + 1) * hopMs) / 1000,
      });
      active = false;
    }
  }

  if (active) {
    raw.push({
      start: (startFrame * hopMs) / 1000,
      end: ((lastVoiceFrame + 1) * hopMs) / 1000,
    });
  }

  const pad = padMs / 1000;
  const padded = raw
    .filter((segment) => (segment.end - segment.start) * 1000 >= minSpeechMs)
    .map((segment) => ({
      start: Math.max(0, segment.start - pad),
      end: Math.min(totalDuration, segment.end + pad),
    }))
    .filter((segment) => segment.end > segment.start);

  /** @type {{ start: number, end: number }[]} */
  const merged = [];
  for (const segment of padded) {
    const last = merged[merged.length - 1];
    if (last && segment.start - last.end <= minSilenceMs / 2000) {
      last.end = Math.max(last.end, segment.end);
    } else {
      merged.push({ ...segment });
    }
  }

  return merged.map((segment) => ({
    start: Math.round(segment.start * 1000) / 1000,
    end: Math.round(segment.end * 1000) / 1000,
  }));
}
