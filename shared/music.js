/** Resolve legacy/full-song selections and clamp editable trim boundaries. */
export function resolveMusicTrim(settings = {}, sourceDuration = 0) {
  const duration = Math.max(0, Number(sourceDuration) || 0);
  if (!duration) return { start: 0, end: 0, length: 0 };
  const minimum = Math.min(0.05, duration);
  const rawStart = Number(settings.musicStartSeconds);
  const rawEnd = Number(settings.musicEndSeconds);
  const start = Math.max(0, Math.min(duration - minimum, Number.isFinite(rawStart) ? rawStart : 0));
  const end = Math.max(start + minimum, Math.min(duration, Number.isFinite(rawEnd) && rawEnd > 0 ? rawEnd : duration));
  return { start, end, length: end - start };
}

export function musicOffsetAt(projectTime, trim) {
  return trim.start + (trim.length > 0 ? Math.max(0, projectTime) % trim.length : 0);
}

/** One bounded periodic cycle: a linear tail/head overlap, then the middle. */
export function resolveMusicFit(settings = {}, sourceDuration = 0, sampleRate = 48000) {
  const trim = resolveMusicTrim(settings, sourceDuration);
  const frames = Math.max(1, Math.round(trim.length * sampleRate));
  const overlapFrames = Math.max(0, Math.min(Math.round(Math.min(2000, Number(settings.loopCrossfadeMs) || 0) * sampleRate / 1000), Math.floor((frames - 1) / 2)));
  const overlap = overlapFrames / sampleRate;
  return { ...trim, overlap, period: trim.length - overlap };
}

export function musicFadeAt(time, duration, settings = {}) {
  const fadeIn = Math.max(0, Math.min(10000, Number(settings.musicFadeInMs) || 0)) / 1000;
  const fadeOut = Math.max(0, Math.min(10000, Number(settings.musicFadeOutMs) || 0)) / 1000;
  return (fadeIn ? Math.max(0, Math.min(1, time / fadeIn)) : 1) *
    (fadeOut ? Math.max(0, Math.min(1, (duration - time) / fadeOut)) : 1);
}

export function fittedMusicSample(channel, sampleRate, time, fit) {
  const phase = Math.max(0, time) % fit.period;
  const at = seconds => channel[Math.min(channel.length - 1, Math.round(seconds * sampleRate))] || 0;
  if (fit.overlap > 0 && phase < fit.overlap) {
    const mix = phase / fit.overlap;
    return at(fit.end - fit.overlap + phase) * (1 - mix) + at(fit.start + phase) * mix;
  }
  return at(fit.start + phase);
}
