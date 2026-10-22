import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
try {
 const page = await browser.newPage();
 await page.goto(process.env.APP_URL || 'http://localhost:5173');
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
     await new Promise(resolve=>setTimeout(resolve,12));
   }
   engine.pause();
   engine.seek(1);
   await engine.play();
   await new Promise(resolve=>setTimeout(resolve,100));
   engine.setAutomation(curve,-12,false);
   const playing=engine.isPlaying;
   engine.destroy();
   return {playing,changes:13};
 });
 assert.equal(result.playing,true);
 console.log('Real Web Audio preview passed: 13 live automation changes, bypass, pause, seek and replay.');
} finally { await browser.close(); }
