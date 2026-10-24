import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runFfmpeg } from '../server/media.mjs';

const dir = await mkdtemp(join(tmpdir(), 'audioduck-mastering-ui-'));
const origin = 'http://127.0.0.1:4298';
const errors = [];
let service, browser;
let logs = '';
const stop = async () => {
  if (!service || service.exitCode !== null) return;
  const done = new Promise(resolve => service.once('exit', resolve));
  service.kill('SIGTERM');
  await done;
};
const start = async () => {
  service = spawn(process.execPath, ['server/index.mjs'], {
    env: { ...process.env, DATA_DIR: join(dir, 'data'), PORT: '4298', VAD_BACKEND: 'node' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  service.stdout.on('data', chunk => { logs += chunk; });
  service.stderr.on('data', chunk => { logs += chunk; });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${origin}/api/health`)).ok) return; } catch {}
    if (service.exitCode !== null) throw new Error(logs);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Test API did not start: ${logs}`);
};
try {
  await runFfmpeg(['-f','lavfi','-i','flite=text=Welcome to Audio Duck Studio. Keep your voice clear while the music fades naturally. This is a synthetic mastering check.:voice=slt','-ar','48000',join(dir,'voice.wav')]);
  await runFfmpeg(['-f','lavfi','-i','sine=frequency=440:duration=12:sample_rate=48000',join(dir,'music.wav')]);
  await start();
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const upload = async role => {
    const response = await page.request.post(`${origin}/api/uploads?role=${role}&filename=${role}.wav`, { data: await readFile(join(dir, `${role}.wav`)) });
    assert.equal(response.status(), 201);
    return (await response.json()).uploadId;
  };
  const voiceUploadId = await upload('voice'), musicUploadId = await upload('music');
  const created = await page.request.post(`${origin}/api/projects`, { data: { name: 'Synthetic mastering verification', voiceUploadId, musicUploadId } });
  assert.equal(created.status(), 201);
  const project = (await created.json()).project;
  await page.goto(`${origin}/#/project/${project.id}`);
  const toggle = page.getByRole('checkbox', { name: /Smart Loudness Mastering/ });
  await toggle.waitFor();
  assert.equal(await toggle.isChecked(), true);
  const preset = page.getByLabel('Mastering preset');
  assert.equal(await preset.inputValue(), 'youtube');
  for (const id of ['reels','podcast','advertisements','youtube']) {
    await preset.selectOption(id);
    assert.ok((await page.locator('.mastering-targets').innerText()).includes(id === 'podcast' || id === 'advertisements' ? '−16.0 LUFS' : '−14.0 LUFS'));
  }
  await toggle.uncheck();
  assert.equal(await preset.count(), 0);
  await toggle.check();
  await page.getByRole('button', { name: 'WAV Lossless', exact: true }).click();
  const requestPromise = page.waitForRequest(request => request.url().endsWith('/export') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Render WAV', exact: true }).click();
  const request = await requestPromise;
  assert.deepEqual(request.postDataJSON().mastering, { enabled: true, preset: 'youtube' });
  await page.getByText('Render complete', { exact: true }).waitFor({ timeout: 60_000 });
  await page.getByRole('region', { name: 'Mastering report' }).waitFor();
  const history = (await (await page.request.get(`${origin}/api/projects/${project.id}`)).json()).project.exports;
  const output = history[0];
  assert.equal(output.mastering.preset, 'youtube');
  assert.ok(output.mastering.after.truePeakDbtp <= -1.4);
  assert.ok(Math.abs(output.mastering.after.integratedLufs + 14) <= 1);
  assert.equal((await page.request.get(`${origin}${output.downloadUrl}`)).status(), 200);
  const invalid = await page.request.post(`${origin}/api/projects/${project.id}/export`, { data: { format: 'wav', mastering: { enabled: true, preset: 'official-platform' } } });
  assert.equal(invalid.status(), 422);

  const screenshots = resolve('.impeccable/review');
  await mkdir(screenshots, { recursive: true });
  for (const [name, width, height] of [['desktop',1440,1050],['mobile',390,844]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.editor-side').scrollTop = 0; });
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ tag: el.tagName, className: el.className, right: el.getBoundingClientRect().right, text: el.textContent?.slice(0, 80) })).slice(-15) }));
    await page.screenshot({ path: join(screenshots, `mastering-${name}.png`), fullPage: true });
    if (name === 'desktop') {
      await page.setViewportSize({ width, height: 2200 });
      await page.evaluate(() => { document.querySelector('.editor-side').scrollTop = 0; });
    }
    await page.locator('#export-panel').screenshot({ path: join(screenshots, `mastering-${name}-detail.png`), style: '.editor-topbar { visibility: hidden !important; }' });
    assert.ok(overflow.scroll <= overflow.width, `${name} overflow: ${JSON.stringify(overflow)}`);
  }

  await toggle.uncheck();
  const disabledResponse = page.waitForResponse(response => response.url().endsWith('/export') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Render WAV', exact: true }).click();
  const disabledJob = (await (await disabledResponse).json()).job;
  for (let i = 0; i < 200; i++) {
    const next = (await (await page.request.get(`${origin}/api/jobs/${disabledJob.id}`)).json()).job;
    if (next.status === 'completed') break;
    assert.notEqual(next.status, 'failed', next.error);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await page.getByText('Render complete', { exact: true }).waitFor({ timeout: 60_000 });
  const refreshed = (await (await page.request.get(`${origin}/api/projects/${project.id}`)).json()).project;
  assert.equal(refreshed.exports[0].mastering, null);
  assert.equal(refreshed.exports[0].normalize, false);
  const defaultResponse = await page.request.post(`${origin}/api/projects/${project.id}/export`, { data: { format: 'wav' } });
  assert.equal(defaultResponse.status(), 202);
  const defaultJob = (await defaultResponse.json()).job;
  assert.deepEqual(defaultJob.mastering, { enabled: true, preset: 'youtube' });
  let done;
  for (let i = 0; i < 200; i++) {
    done = (await (await page.request.get(`${origin}/api/jobs/${defaultJob.id}`)).json()).job;
    if (done.status === 'completed') break;
    assert.notEqual(done.status, 'failed', done.error);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(done.status, 'completed');
  await stop();
  await start();
  const restored = (await (await page.request.get(`${origin}/api/jobs/${defaultJob.id}`)).json()).job;
  assert.equal(restored.output.mastering.preset, 'youtube');
  assert.deepEqual(restored.output.mastering.after, done.output.mastering.after);
  await page.reload();
  await page.locator('.previous-mastering').first().locator('summary').first().click();
  assert.equal(await page.getByRole('region', { name: 'Mastering report' }).count(), 1);
  assert.deepEqual(errors, []);
  console.log('Mastering UI/API passed: default, all presets, encoded report, disable, validation, download and restart persistence; desktop/mobile captures saved.');
} finally {
  await browser?.close();
  await stop();
  await rm(dir, { recursive: true, force: true });
}
