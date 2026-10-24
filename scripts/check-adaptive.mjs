import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runFfmpeg } from '../server/media.mjs';

const dir = await mkdtemp(join(tmpdir(), 'audioduck-adaptive-ui-'));
const origin = 'http://127.0.0.1:4297';
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
    env: { ...process.env, DATA_DIR: join(dir, 'data'), PORT: '4297', VAD_BACKEND: 'node' },
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
  const created = await page.request.post(`${origin}/api/projects`, { data: { name: 'Synthetic adaptive verification', voiceUploadId, musicUploadId } });
  assert.equal(created.status(), 201);
  const project = (await created.json()).project;
  const bounds=await page.request.patch(`${origin}/api/projects/${project.id}`,{data:{settings:{adaptiveMaxReductionDb:36,adaptiveMinReductionDb:30}}});
  assert.equal((await bounds.json()).project.settings.adaptiveMinReductionDb,30,'API must preserve the minimum offered by the UI');
  await page.request.patch(`${origin}/api/projects/${project.id}`,{data:{settings:{adaptiveMaxReductionDb:18,adaptiveMinReductionDb:2}}});
  await page.goto(`${origin}/#/project/${project.id}`);
  const mode = page.getByRole('group',{name:'Ducking mode'});
  await mode.waitFor();
  assert.equal(await mode.getByRole('button',{name:'Adaptive',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByText('Adaptive curve ready',{exact:true}).waitFor({timeout:60_000});
  const ready=()=>page.getByText('Adaptive curve ready',{exact:true}).waitFor({timeout:60_000});
  const gap=page.getByRole('slider',{name:'Target level gap',exact:true});
  await gap.press('ArrowRight');
  await ready();
  assert.equal(await gap.inputValue(),'10.5');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await ready();
  assert.equal(await gap.inputValue(),'10');
  await page.getByRole('button',{name:'Redo',exact:true}).click();
  await ready();
  assert.equal(await gap.inputValue(),'10.5');
  await page.getByRole('button',{name:'Play preview',exact:true}).click();
  await gap.press('ArrowRight');
  await ready();
  await page.getByRole('button',{name:'Original',exact:true}).click();
  await page.getByRole('button',{name:'Ducked',exact:true}).click();
  await page.getByRole('button',{name:'Pause preview',exact:true}).click();
  await page.locator('.region-row-main').first().click();
  const automatic=page.getByRole('checkbox',{name:/Automatic region reduction/});
  await automatic.uncheck();
  await page.getByRole('slider',{name:'Region reduction',exact:true}).press('ArrowRight');
  await ready();
  const limit=page.getByRole('slider',{name:'Maximum reduction',exact:true});
  await limit.press('ArrowLeft');
  await ready();
  await page.getByRole('spinbutton',{name:'Start (seconds)'}).fill('1');
  await page.getByRole('spinbutton',{name:'End (seconds)'}).fill('3');
  await ready();
  await page.waitForFunction(()=>document.querySelector('.save-state')?.textContent?.trim()==='Saved locally');
  let saved=(await (await page.request.get(`${origin}/api/projects/${project.id}`)).json()).project;
  assert.equal(saved.settings.duckingMode,'adaptive');
  assert.equal(saved.settings.musicStartSeconds,1);
  assert.ok(saved.segments.some(region=>region.reductionDb===9.5));
  const levelsResponse=await page.request.post(`${origin}/api/projects/${project.id}/adaptive-levels`,{data:{settings:saved.settings}});
  assert.equal(levelsResponse.status(),200);
  const levels=(await levelsResponse.json()).levels;
  assert.equal(levels.voiceRms.length,Math.ceil(saved.duration*50));

  const screenshots=resolve('.impeccable/review');
  await mkdir(screenshots,{recursive:true});
  if(!process.argv.includes('--no-capture')) for(const [name,width,height] of [['desktop',1440,1050],['mobile',390,844]]) {
    await page.setViewportSize({width,height});
    await page.evaluate(()=>document.fonts.ready);
    await page.evaluate(()=>{scrollTo(0,0);document.querySelector('.editor-side').scrollTop=0;});
    await page.screenshot({path:join(screenshots,`adaptive-${name}.png`),fullPage:true});
    await page.setViewportSize({width,height:name==='desktop'?2200:1400});
    await page.locator('section[aria-labelledby="ducking-title"]').screenshot({path:join(screenshots,`adaptive-${name}-detail.png`),style:'.editor-topbar { visibility:hidden!important; }'});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} overflow`);
  }
  await page.getByRole('checkbox',{name:/Smart Loudness Mastering/}).uncheck();
  await page.getByRole('button',{name:'WAV Lossless',exact:true}).click();
  await page.getByRole('button',{name:'Render WAV',exact:true}).click();
  await page.getByText('Render complete',{exact:true}).waitFor({timeout:60_000});
  saved=(await (await page.request.get(`${origin}/api/projects/${project.id}`)).json()).project;
  assert.equal((await page.request.get(`${origin}${saved.exports[0].downloadUrl}`)).status(),200);
  const fixedSaved=page.waitForResponse(response=>response.url().endsWith(`/api/projects/${project.id}`)&&response.request().method()==='PATCH'&&response.request().postDataJSON()?.settings?.duckingMode==='fixed');
  await mode.getByRole('button',{name:'Fixed',exact:true}).click();
  await page.getByRole('slider',{name:'Music reduction',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.save-state')?.textContent?.trim()==='Saved locally');
  assert.equal((await fixedSaved).status(),200);
  await page.reload();
  await page.getByRole('slider',{name:'Music reduction',exact:true}).waitFor();
  assert.equal(await page.getByRole('group',{name:'Ducking mode'}).getByRole('button',{name:'Fixed',exact:true}).getAttribute('aria-pressed'),'true');
  // Emulate an existing pre-feature project on isolated test storage, then migrate at startup.
  await stop();
  const projectFile=join(dir,'data','projects',project.id,'project.json');
  const legacy=JSON.parse(await readFile(projectFile,'utf8'));
  delete legacy.settings.duckingMode;
  const {writeFile}=await import('node:fs/promises');
  await writeFile(projectFile,JSON.stringify(legacy));
  await start();
  await page.reload();
  await ready();
  saved=(await (await page.request.get(`${origin}/api/projects/${project.id}`)).json()).project;
  assert.equal(saved.settings.duckingMode,'adaptive');
  assert.equal(saved.settings.musicStartSeconds,1);
  assert.ok(saved.segments.some(region=>region.reductionDb===9.5));
  await page.route('**/wasm/adaptive_ducking.wasm',route=>route.abort());
  await page.reload();
  await page.locator('.adaptive-analysis-state[role="alert"]').waitFor({timeout:60_000});
  await page.getByRole('group',{name:'Ducking mode'}).getByRole('button',{name:'Fixed',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Play preview',exact:true}).isDisabled(),false);
  await page.getByRole('group',{name:'Ducking mode'}).getByRole('button',{name:'Adaptive',exact:true}).click();
  await page.unroute('**/wasm/adaptive_ducking.wasm');
  await page.getByRole('button',{name:'Retry analysis',exact:true}).click();
  await ready();
  assert.deepEqual(errors,[]);
  console.log('Adaptive UI/API passed: real Rust WASM Worker, defaults, live gap updates, undo/redo, region overrides, trim analysis, preview/bypass, export, Fixed persistence and existing-project migration; desktop/mobile captures saved.');
} finally {
  await browser?.close();
  await stop();
  await rm(dir,{recursive:true,force:true});
}
