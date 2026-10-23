import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const release = process.argv.includes('--release');
const origin = release ? 'http://127.0.0.1:5199' : process.env.APP_URL || 'http://localhost:5173';
const page = await browser.newPage();
let projectId;
let service, testDir, vite;
const apiOrigin = release ? 'http://127.0.0.1:4199' : origin;
try {
 if (release) {
   testDir = await mkdtemp(join(tmpdir(),'audioduck-release-'));
   service=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,DATA_DIR:testDir,PORT:'4199'},stdio:['ignore','pipe','pipe']});
   let logs=''; service.stdout.on('data',chunk=>logs+=chunk);service.stderr.on('data',chunk=>logs+=chunk);
   for(let i=0;i<100;i++){try{if((await fetch(`${apiOrigin}/api/health`)).ok)break;}catch{} if(i===99)throw new Error(logs);await new Promise(resolve=>setTimeout(resolve,100));}
   const {createServer} = await import('vite');
   vite = await createServer({configFile:'vite.config.ts',server:{host:'127.0.0.1',port:5199,strictPort:true,proxy:{'/api':{target:apiOrigin},'/media':{target:apiOrigin}}}});
   await vite.listen();
 }
 const errors = [];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin);
 const result = await page.evaluate(async () => {
   const {PreviewAudio}=await import('/src/lib/audioEngine.ts');
   const context=new AudioContext();
   const musicGain=context.createGain();
   musicGain.connect(context.destination);
   const voiceGain=context.createGain();
   voiceGain.connect(context.destination);
   const buffer=context.createBuffer(1,context.sampleRate*4,context.sampleRate);
   const engine=new PreviewAudio();
   Object.assign(engine,{context,musicGain,voiceGain,voiceBuffer:buffer,musicBuffer:buffer,duration:4});
   const curve=new Float32Array(800).fill(.25);
   engine.setAutomation(curve,-12,false);
   await engine.play();
   await new Promise(resolve=>setTimeout(resolve,160));
   for(let i=0;i<12;i++) {
     engine.setAutomation(curve,-12-i%4,i%2===0);
     engine.setMusicTrim(.1+i*.02,2);
     await new Promise(resolve=>setTimeout(resolve,12));
   }
   engine.pause();
   engine.seek(1);
   await engine.play();
   engine.setAutomation(curve,-12,true);
   await new Promise(resolve=>setTimeout(resolve,100));
   engine.setAutomation(curve,-12,false);
   const playing=engine.isPlaying;
   engine.destroy();
   return {playing,changes:13};
 });
 assert.equal(result.playing,true);
 assert.deepEqual(errors,[]);
 console.log('Real Web Audio preview passed: live trim and bypass changes, immediate seek toggle, pause and replay.');

 const upload = async (role,file) => {
   const response = await page.request.post(`${apiOrigin}/api/uploads?role=${role}&filename=${file}`, {data:await readFile(new URL(`../output/sample/${file}`,import.meta.url))});
   assert.equal(response.status(),201);
   return (await response.json()).uploadId;
 };
 const videoUploadId = await upload('video','synthetic-video.mp4');
 const musicUploadId = await upload('music','synthetic-music.wav');
 const created = await page.request.post(`${apiOrigin}/api/projects`,{data:{name:'Temporary playback regression check',videoUploadId,musicUploadId}});
 assert.equal(created.status(),201);
 projectId = (await created.json()).project.id;
 await page.goto(`${origin}/#/project/${projectId}`);
 await page.getByRole('heading',{name:'Trim music',exact:true}).waitFor();
 await page.getByRole('button',{name:'Play preview',exact:true}).click();
 for(let i=0;i<4;i++) {
   await page.getByRole('button',{name:'Original',exact:true}).click();
   await page.getByRole('spinbutton',{name:'Start (seconds)'}).fill(String(.1+i*.1));
   await page.getByRole('spinbutton',{name:'End (seconds)'}).fill('2.5');
   await page.getByRole('button',{name:'Ducked',exact:true}).click();
 }
 const handle=page.getByRole('slider',{name:'Music trim start',exact:true});
 await handle.press('ArrowRight');
 const box=await handle.boundingBox();
 assert.ok(box);
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await page.mouse.down();
 await page.mouse.move(box.x+box.width/2+20,box.y+box.height/2,{steps:4});
 await page.mouse.up();
 await page.getByRole('button',{name:'Pause preview',exact:true}).click();
 await page.getByRole('button',{name:'Play preview',exact:true}).click();
 await page.getByRole('button',{name:'Original',exact:true}).click();
 if(release) {
   for(const name of ['Music fade-in','Music fade-out','Smooth loop']) {const slider=page.getByRole('slider',{name,exact:true});await slider.press('Home');await slider.press('ArrowRight');await slider.press('ArrowRight');}
   const preset=page.getByLabel('Mix preset');await preset.selectOption('gentle');
   await page.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await preset.inputValue(),'clear-speech');
   await page.getByRole('button',{name:'Redo',exact:true}).click();assert.equal(await preset.inputValue(),'gentle');
   for(const name of ['Solo voice','Mute voice','Solo music','Mute music']){const button=page.getByRole('button',{name,exact:true});await button.click();assert.equal(await button.getAttribute('aria-pressed'),'true');await button.click();}
   assert.equal(await page.getByRole('slider',{name:'Music fade-in',exact:true}).inputValue(),'100');
 }
 await mkdir('output/verification',{recursive:true});
 for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
   await page.setViewportSize({width,height});
   await page.getByRole('heading',{name:'Video preview',exact:true}).waitFor();
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.screenshot({path:`output/verification/editor-${name}.png`,fullPage:true});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} must not overflow`);
 }
 assert.equal(await page.getByText('The audio preview stopped.',{exact:false}).count(),0);
 assert.deepEqual(errors,[]);
 await page.waitForFunction(()=>document.querySelector('.save-state')?.textContent?.trim()==='Saved locally');
 await page.goto(origin);
 if(release) {
   await page.getByRole('group',{name:'Project type'}).getByRole('button',{name:'Audio',exact:true}).click();
   await page.locator('input[type=file]').nth(0).setInputFiles(new URL('../output/sample/synthetic-music.wav',import.meta.url).pathname);
   await page.locator('input[type=file]').nth(1).setInputFiles(new URL('../output/sample/synthetic-music.wav',import.meta.url).pathname);
   await page.getByRole('button',{name:'Create mix',exact:true}).click();
   try { await page.getByRole('heading',{name:'Audio preview',exact:true}).waitFor(); }
   catch(error) { console.error('Audio-only failure', JSON.stringify({url:page.url(),errors,body:await page.locator('body').innerText()})); throw error; }
   const audioId=page.url().split('/project/')[1];
   try {
     assert.equal(await page.getByRole('button',{name:'MP4 Video',exact:true}).count(),0);
     const rejected=await page.request.post(`${apiOrigin}/api/projects/${audioId}/export`,{data:{format:'mp4'}});assert.equal(rejected.status(),422);
     await page.getByRole('button',{name:'Play preview',exact:true}).click();
     await page.getByRole('button',{name:'Original',exact:true}).click();
     await page.getByRole('button',{name:'Solo music',exact:true}).click();
     for(const format of ['wav','mp3']) {
       const response=await page.request.post(`${apiOrigin}/api/projects/${audioId}/export`,{data:{format}});assert.equal(response.status(),202);const job=(await response.json()).job;
       let done;for(let i=0;i<100;i++){done=(await (await page.request.get(`${apiOrigin}/api/jobs/${job.id}`)).json()).job;if(done.status==='completed')break;assert.notEqual(done.status,'failed',done.error);await new Promise(resolve=>setTimeout(resolve,100));}assert.equal(done.status,'completed');
       const download=await page.request.get(`${apiOrigin}${done.output.downloadUrl}`);assert.equal(download.status(),200);assert.ok((await download.body()).length>1024);
     }
     assert.deepEqual(errors,[]);
     await page.screenshot({path:'output/verification/audio-mobile.png',fullPage:true});
     await page.goto(origin);
     console.log('Release passed: preset undo/redo, fades, smooth loops, solo/mute, audio-only upload/create/playback/WAV+MP3 exports and MP4 rejection.');
   } finally {await page.request.delete(`${apiOrigin}/api/projects/${audioId}`);}
 }
 console.log('Editor passed: Original/Ducked clicks, live numeric/keyboard/drag trimming, replay, saved edits and desktop/mobile layouts.');
} finally {
 if(projectId) await page.request.delete(`${apiOrigin}/api/projects/${projectId}`);
 await browser.close();
 if(vite)await vite.close();
 if(service){service.kill('SIGTERM');await new Promise(resolve=>{if(service.exitCode!==null)resolve();else service.once('exit',resolve);});}
 if(testDir)await rm(testDir,{recursive:true,force:true});
}
