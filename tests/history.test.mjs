import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, recordHistory, undoHistory, redoHistory } from '../shared/history.js';
const snapshot = (value) => ({ settings: { reductionDb: value }, segments: [{ start: 0, end: value }] });

test('history clones initial and recorded snapshots and restores both settings and regions', () => {
  const initial = snapshot(1);
  let history = createHistory(initial);
  initial.settings.reductionDb = 99;
  assert.equal(history.present.settings.reductionDb, 1);
  const next = snapshot(2);
  history = recordHistory(history, next);
  next.segments[0].end = 99;
  assert.deepEqual(undoHistory(history).present, snapshot(1));
  assert.deepEqual(redoHistory(undoHistory(history)).present, snapshot(2));
  assert.deepEqual(history.present, snapshot(2));
});

test('rapid matching edits retain the pregesture snapshot and bounded history', () => {
  let history = createHistory(snapshot(0), 2);
  history = recordHistory(history, snapshot(1), { group: 'slider', now: 0 });
  history = recordHistory(history, snapshot(2), { group: 'slider', now: 100 });
  assert.equal(history.past.length, 1);
  assert.deepEqual(undoHistory(history).present, snapshot(0));
  history = recordHistory(history, snapshot(3), { group: 'slider', now: 700 });
  history = recordHistory(history, snapshot(4));
  assert.equal(history.past.length, 2);
  assert.deepEqual(undoHistory(undoHistory(history)).present, snapshot(2));
});

test('no-op preserves redo; real branching truncates redo and clears gesture grouping', () => {
  let history = recordHistory(createHistory(snapshot(0)), snapshot(1), { group: 'slider', now: 0 });
  history = undoHistory(history);
  assert.equal(recordHistory(history, snapshot(0)), history);
  assert.equal(history.future.length, 1);
  history = recordHistory(history, snapshot(2), { group: 'slider', now: 1 });
  assert.equal(history.future.length, 0);
  assert.deepEqual(undoHistory(history).present, snapshot(0));
  assert.equal(redoHistory(history), history);
});

test('ungrouped edits are separate and content equality ignores object key order', () => {
  let history = createHistory({ settings: { a: 1, b: 2 }, segments: [] });
  assert.equal(recordHistory(history, { segments: [], settings: { b: 2, a: 1 } }), history);
  history = recordHistory(history, snapshot(1));
  history = recordHistory(history, snapshot(2));
  assert.equal(history.past.length, 2);
});
