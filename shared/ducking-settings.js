import { DEFAULT_SETTINGS } from './envelope.js';
import { ADAPTIVE_DEFAULTS } from './adaptive.js';

export const NEW_PROJECT_SETTINGS = Object.freeze({
  ...DEFAULT_SETTINGS, ...ADAPTIVE_DEFAULTS,
  duckingMode: 'adaptive', baseMusicDb: -8, lookAheadMs: 100, fadeDownMs: 50,
});

/** Existing mixes opt into adaptive while preserving all previous musical edits. */
export function migrateDuckingSettings(settings = {}) {
  return { ...NEW_PROJECT_SETTINGS, ...settings,
    duckingMode: settings.duckingMode === 'fixed' ? 'fixed' : 'adaptive' };
}
