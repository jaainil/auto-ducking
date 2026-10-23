import test from 'node:test';
import assert from 'node:assert/strict';
import { MIX_PRESETS, applyPreset } from '../shared/presets.js';

test('four built-in presets provide unique ids, descriptions and ducking values', () => {
  assert.deepEqual(MIX_PRESETS.map(preset => preset.name), ['Gentle', 'Clear Speech', 'Strong Ducking', 'Long Recovery']);
  assert.equal(new Set(MIX_PRESETS.map(preset => preset.id)).size, 4);
  for (const preset of MIX_PRESETS) {
    assert.ok(preset.description.length > 0);
    assert.deepEqual(Object.keys(preset.settings).sort(), ['baseMusicDb', 'fadeDownMs', 'holdMs', 'lookAheadMs', 'reductionDb', 'releaseMs']);
  }
});

test('all presets preserve music selection, fades, crossfade and detection preferences', () => {
  const settings = { reductionDb: 1, musicStartSeconds: 3, musicEndSeconds: 9, musicFadeInMs: 250, musicFadeOutMs: 500, loopCrossfadeMs: 150, threshold: .3, minSpeechMs: 80, minSilenceMs: 100, padMs: 40 };
  const original = structuredClone(settings);
  for (const preset of MIX_PRESETS) {
    const result = applyPreset(settings, preset.id);
    assert.deepEqual(result, { ...settings, ...preset.settings });
    assert.notEqual(result, settings);
  }
  assert.deepEqual(settings, original);
  assert.deepEqual(applyPreset(settings, 'missing'), settings);
});
