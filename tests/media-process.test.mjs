import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../server/media.mjs';

for (const channel of ['stdout', 'stderr']) {
  test(`subprocess ${channel} callback errors reject safely and stop the child`, async () => {
    let child;
    const stopped = new Error('Processing cancelled by callback');
    const args = ['-hide_banner','-nostdin','-loglevel',channel === 'stdout' ? 'error' : 'info','-f','lavfi','-i','sine=duration=2',...(channel === 'stdout' ? ['-progress','pipe:1'] : []),'-f','null','-'];
    await assert.rejects(run('ffmpeg', args, {
      timeoutMs: 2000,
      onSpawn: value => { child = value; },
      [channel === 'stdout' ? 'onStdout' : 'onStderr']: () => { throw stopped; },
    }), error => error === stopped);
    assert.equal(child.killed, true);
  });
}
