import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvelope, DEFAULT_SETTINGS, dbToGain, segmentsFromProbabilities, reconcileSegments } from '../shared/envelope.js';
const settings = { ...DEFAULT_SETTINGS, lookAheadMs: 0, fadeDownMs: 1000, holdMs: 0, releaseMs: 1000 };
test('smooth fades interpolate in decibels, with exact reduction during speech', () => {
  const curve = buildEnvelope([{ start: 2, end: 3 }], settings, 5, 1000);
  assert.ok(Math.abs(curve[1500] - dbToGain(-6)) < 1e-6, 'fade midpoint must be -6 dB');
  assert.ok(Math.abs(curve[2500] - dbToGain(-12)) < 1e-6);
  assert.ok(Math.abs(curve[3500] - dbToGain(-6)) < 1e-6);
  assert.equal(curve[4500], 1);
});
test('overlapping fades keep music down through short pauses', () => {
  const curve = buildEnvelope([{start: 1, end: 2}, {start: 2.4, end: 3}], DEFAULT_SETTINGS, 5, 1000);
  assert.ok(Math.abs(curve[2200] - dbToGain(-12)) < 1e-6);
});
test('disabled and invalid regions never duck music', () => {
  const curve = buildEnvelope([{start: 1, end: 2, enabled: false}, {start: NaN, end: 2}], DEFAULT_SETTINGS, 3);
  assert.ok(curve.every(value => value === 1));
  assert.throws(() => buildEnvelope([], DEFAULT_SETTINGS, 0));
});
test('silence produces no speech; sustained probability produces padded speech', () => {
  assert.deepEqual(segmentsFromProbabilities(Array(50).fill(0), 32), []);
  const regions = segmentsFromProbabilities([...Array(10).fill(0), ...Array(20).fill(0.9), ...Array(15).fill(0)], 32);
  assert.equal(regions.length, 1);
  assert.ok(regions[0].start < .32 && regions[0].end > .96);
});
test('redetection preserves manual overrides and disabled detections', () => {
  const next = reconcileSegments([{start: 1, end: 2}, {start: 4, end: 5}], [{id:'manual', start:1.1,end:2.1,source:'manual',enabled:true}, {start:4,end:5,source:'vad',enabled:false}]);
  assert.equal(next.find(region => region.id === 'manual').enabled, true);
  assert.equal(next.find(region => region.start === 4).enabled, false);
  assert.equal(next.length, 2);
});
