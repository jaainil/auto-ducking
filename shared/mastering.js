/** Suggested creative targets, not official platform requirements. */
export const MASTERING_PRESETS = Object.freeze([
  { id: 'reels', name: 'Reels', description: 'A consistent level for short social videos.', integratedLufs: -14, truePeakDbtp: -1.5, loudnessRangeLu: 7 },
  { id: 'youtube', name: 'YouTube', description: 'Balanced loudness with room for dynamics.', integratedLufs: -14, truePeakDbtp: -1.5, loudnessRangeLu: 11 },
  { id: 'podcast', name: 'Podcast', description: 'A comfortable level for spoken audio.', integratedLufs: -16, truePeakDbtp: -1.5, loudnessRangeLu: 7 },
  { id: 'advertisements', name: 'Advertisements', description: 'Controlled dynamics for promotional audio.', integratedLufs: -16, truePeakDbtp: -2, loudnessRangeLu: 5 },
].map(preset => Object.freeze(preset)));

export function getMasteringPreset(id) {
  const preset = MASTERING_PRESETS.find((entry) => entry.id === id);
  if (!preset) throw new Error('Unknown mastering preset.');
  return preset;
}

export function resolveMastering(options = {}) {
  if (options.mastering === undefined) {
    return { enabled: options.normalize === true, preset: options.normalize === true ? 'podcast' : 'youtube' };
  }
  const value = options.mastering;
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.enabled !== 'boolean') {
    throw new Error('Mastering must include an enabled boolean and a valid preset.');
  }
  getMasteringPreset(value.preset);
  return { enabled: value.enabled, preset: value.preset };
}
