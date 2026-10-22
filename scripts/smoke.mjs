import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const origin = process.env.APP_URL || 'http://localhost:5173';
const page = await browser.newPage();
let projectId;
try {
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
   const response = await page.request.post(`${origin}/api/uploads?role=${role}&filename=${file}`, {data:await readFile(new URL(`../output/sample/${file}`,import.meta.url))});
   assert.equal(response.status(),201);
   return (await response.json()).uploadId;
 };
 const videoUploadId = await upload('video','synthetic-video.mp4');
 const musicUploadId = await upload('music','synthetic-music.wav');
 const created = await page.request.post(`${origin}/api/projects`,{data:{name:'Temporary playback regression check',videoUploadId,musicUploadId}});
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
 await mkdir('output/verification',{recursive:true});
 for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
   await page.setViewportSize({width,height});
   await page.getByRole('heading',{name:'Video preview',exact:true}).waitFor();
   await page.screenshot({path:`output/verification/editor-${name}.png`,fullPage:true});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} must not overflow`);
 }
 assert.equal(await page.getByText('The audio preview stopped.',{exact:false}).count(),0);
 assert.deepEqual(errors,[]);
 await page.waitForFunction(()=>document.querySelector('.save-state')?.textContent?.trim()==='Saved');
 await page.goto(origin);
 console.log('Editor passed: Original/Ducked clicks, live numeric/keyboard/drag trimming, replay, saved edits and desktop/mobile layouts.');
} finally {
 if(projectId) await page.request.delete(`${origin}/api/projects/${projectId}`);
 await browser.close();
}
