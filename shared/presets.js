/** Presets alter only mix controls, preserving selection and detection edits. */
export const MIX_PRESETS = Object.freeze([
  { id: 'gentle', name: 'Gentle', description: 'Subtle dips that keep the music present.', settings: { reductionDb: 6, baseMusicDb: -12, lookAheadMs: 60, fadeDownMs: 180, holdMs: 150, releaseMs: 450 } },
  { id: 'clear-speech', name: 'Clear Speech', description: 'Balanced ducking that gives speech room.', settings: { reductionDb: 12, baseMusicDb: -12, lookAheadMs: 80, fadeDownMs: 120, holdMs: 200, releaseMs: 500 } },
  { id: 'strong-ducking', name: 'Strong Ducking', description: 'Deeper, faster dips for prominent speech.', settings: { reductionDb: 20, baseMusicDb: -12, lookAheadMs: 100, fadeDownMs: 80, holdMs: 250, releaseMs: 600 } },
  { id: 'long-recovery', name: 'Long Recovery', description: 'Let music return slowly between phrases.', settings: { reductionDb: 14, baseMusicDb: -12, lookAheadMs: 100, fadeDownMs: 140, holdMs: 400, releaseMs: 1400 } },
].map(preset => Object.freeze({ ...preset, settings: Object.freeze(preset.settings) })));

export const PRESETS = MIX_PRESETS;

export function applyPreset(current, id) {
  const preset = MIX_PRESETS.find(item => item.id === id);
  return { ...current, ...preset?.settings };
}
