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
