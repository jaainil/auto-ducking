/** Session-local immutable snapshot history for plain editor state. */
const GROUP_WINDOW_MS = 500;
const clone = (value) => structuredClone(value);

function equal(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
}

/** @returns {{ past: any[], present: any, future: any[], limit: number, group: string | null, lastRecordedAt: number | null }} */
export function createHistory(initial, limit = 100) {
  return { past: [], present: clone(initial), future: [], limit: Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 100, group: null, lastRecordedAt: null };
}

/**
 * @param {ReturnType<typeof createHistory>} history
 * @param {any} next
 * @param {{ group?: string | null, now?: number }} options
 */
export function recordHistory(history, next, { group = null, now = Date.now() } = {}) {
  if (equal(history.present, next)) return history;
  const elapsed = now - history.lastRecordedAt;
  const merge = group != null && group === history.group && history.lastRecordedAt != null && elapsed >= 0 && elapsed <= GROUP_WINDOW_MS;
  return {
    ...history,
    past: merge ? history.past : [...history.past, clone(history.present)].slice(-history.limit),
    present: clone(next),
    future: [],
    group,
    lastRecordedAt: now,
  };
}

export function undoHistory(history) {
  if (!history.past.length) return history;
  return {
    ...history,
    past: history.past.slice(0, -1),
    present: clone(history.past.at(-1)),
    future: [clone(history.present), ...history.future],
    group: null,
    lastRecordedAt: null,
  };
}

export function redoHistory(history) {
  if (!history.future.length) return history;
  return {
    ...history,
    past: [...history.past, clone(history.present)].slice(-history.limit),
    present: clone(history.future[0]),
    future: history.future.slice(1),
    group: null,
    lastRecordedAt: null,
  };
}
