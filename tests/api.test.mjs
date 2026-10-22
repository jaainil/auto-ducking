import test from 'node:test';
import assert from 'node:assert/strict';
import { getHealth, listProjects } from '../src/lib/api.ts';

test('HTML fallback from an unconfigured dev proxy produces an actionable error', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('<!doctype html><html></html>', {headers:{'Content-Type':'text/html'}});
  try { await assert.rejects(getHealth(), /Restart.*npm run dev/); }
  finally { globalThis.fetch = original; }
});
test('project listing accepts a valid JSON response', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({projects:[]});
  try { assert.deepEqual(await listProjects(), []); }
  finally { globalThis.fetch = original; }
});
