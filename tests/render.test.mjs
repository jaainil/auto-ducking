import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const temp = await mkdtemp(join(tmpdir(), 'audioduck-test-'));
process.env.DATA_DIR = temp;
const { runFfmpeg, probeMedia, decodePcm16k } = await import('../server/media.mjs');
const { renderProject, RenderCancelled } = await import('../server/render.mjs');
const { DEFAULT_SETTINGS } = await import('../shared/envelope.js');
const { loadVoiceDetector, detectSpeech } = await import('../server/vad.mjs');
const id = 'testproject123';
const dir = join(temp, 'projects', id);
await mkdir(dir, { recursive: true });
const project = { id, name: 'Verification', duration: 4, media: { video: 'source.mp4', voiceWav:'voice.wav', music:'music.wav' }, segments:[{start:1,end:2,enabled:true}], settings: {...DEFAULT_SETTINGS, baseMusicDb:0} };
test('native media pipeline: detection, exact ducking, MP4/WAV/MP3, normalization and cancellation', async t => {
  try {
    await runFfmpeg(['-f','lavfi','-i','color=c=blue:s=160x120:r=24:d=4','-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t','4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',join(dir,'source.mp4')]);
    await runFfmpeg(['-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t','4',join(dir,'voice.wav')]);
    await runFfmpeg(['-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1','-ac','2',join(dir,'music.wav')]);
    await t.test('Silero model loads and rejects silence', async () => {
      const detector = await loadVoiceDetector(new URL('../server/models/silero_vad.onnx', import.meta.url).pathname);
      assert.equal(detector.engine, 'silero');
      const result = await detectSpeech(new Float32Array(16000), detector);
      assert.ok(result.probabilities.every(p => p < .5));
      await runFfmpeg(['-f','lavfi','-i','flite=text=Welcome to Audio Duck Studio. Your voice stays clear while the music fades naturally.:voice=slt','-ar','16000',join(dir,'speech.wav')]);
      const speech = await detectSpeech(await decodePcm16k(join(dir,'speech.wav')), detector);
      assert.ok(speech.probabilities.some(p => p > .5), 'spoken audio must trigger speech detection');
      await detector.session.release();
    });
    for (const format of ['wav','mp3','mp4']) {
      await t.test(`renders and verifies ${format} with looped music`, async () => {
        const output = await renderProject(project, {format, jobId:format, normalize:false});
        const file = join(dir,'exports',output.file);
        const info = await probeMedia(file);
        assert.ok(info.hasAudio);
        assert.ok(Math.abs(info.duration - 4) < .1);
        if(format === 'mp4') assert.ok(info.hasVideo);
        if(format === 'wav') {
          const samples = await decodePcm16k(file);
          const rms = (start,end) => Math.sqrt(samples.slice(start*16000,end*16000).reduce((s,v)=>s+v*v,0)/((end-start)*16000));
          const reduction = 20*Math.log10(rms(1.2,1.8)/rms(.1,.5));
          assert.ok(Math.abs(reduction + 12) < .2, `measured ${reduction} dB`);
        }
      });
    }
    await t.test('normalizes final audio and cleans control files', async () => {
      await renderProject(project,{format:'wav',jobId:'normalized',normalize:true});
      assert.ok(!(await readdir(dir)).some(name => name.startsWith('automation-')));
    });
    await t.test('exports only the selected music section, looping it to fit', async () => {
      await runFfmpeg(['-f','lavfi','-i','aevalsrc=if(between(t\\,1\\,2)\\,0.1*sin(2*PI*440*t)\\,0):s=48000:d=3',join(dir,'trim-song.wav')]);
      const selected = {...project, source:{music:{duration:3}}, media:{...project.media,music:'trim-song.wav'}, settings:{...project.settings,reductionDb:0,musicStartSeconds:1,musicEndSeconds:2}};
      const result = await renderProject(selected,{format:'wav',jobId:'trimmed'});
      const samples = await decodePcm16k(join(dir,'exports',result.file));
      for (const start of [.1,1.1,2.1,3.1]) {
        const window = samples.slice(Math.round(start*16000),Math.round((start+.3)*16000));
        const rms = Math.sqrt(window.reduce((sum,value)=>sum+value*value,0)/window.length);
        assert.ok(rms>.04, `selection should contain music at ${start}s, got RMS ${rms}`);
      }
      assert.ok(!(await readdir(dir)).some(name=>name.startsWith('music-selection-')));
    });
    await t.test('audio-only fades and smooth cycles match shared samples', async () => {
      const {resolveMusicFit,fittedMusicSample,musicFadeAt}=await import('../shared/music.js');
      await runFfmpeg(['-f','lavfi','-i','aevalsrc=0.1+0.1*t|0.1+0.1*t:s=48000:d=1',join(dir,'ramp.wav')]);
      const settings={...project.settings,reductionDb:0,loopCrossfadeMs:200,musicFadeInMs:1000,musicFadeOutMs:1000};
      const audio={...project,segments:[],media:{...project.media,video:null,music:'ramp.wav'},source:{music:{duration:1}},settings};
      await assert.rejects(renderProject(audio,{format:'mp4',jobId:'no-video'}),/video/i);
      const output=await renderProject(audio,{format:'wav',jobId:'smooth-fade'});
      const samples=await decodePcm16k(join(dir,'exports',output.file));
      const fit=resolveMusicFit(settings,1);
      const source=Float32Array.from({length:48000},(_,i)=>.1+.1*i/48000);
      // Limiter has its usual small attack lookahead; constant ramps are checked
      // away from transitions, with tolerance for PCM and filter resampling.
      for(const time of [.1,.5,.9,1.3,2.1,3.5,3.9]) {
        const actual=samples[Math.round(time*16000)];
        const expected=fittedMusicSample(source,48000,time,fit)*musicFadeAt(time,4,settings);
        assert.ok(Math.abs(actual-expected)<.006,`${time}: ${actual} vs ${expected}`);
      }
      for(const boundary of [.8,1.6,2.4,3.2]) {
        const i=Math.round(boundary*16000);
        assert.ok(Math.abs(samples[i+1]-samples[i-1])<.003,'crossfade boundary is continuous');
      }
    });
    await t.test('honors cancellation before processing', async () => {
      await assert.rejects(renderProject(project,{format:'wav',jobId:'cancelled'},{cancelled:()=>true}), RenderCancelled);
    });
    await t.test('removes partial exports when verification is interrupted', async () => {
      await assert.rejects(renderProject(project,{format:'wav',jobId:'interrupted'},{progress:(_,stage)=>{if(stage==='Checking the export') throw new RenderCancelled();}}), RenderCancelled);
      assert.ok(!(await readdir(join(dir,'exports'))).includes('render-interrupted.wav'));
    });
  } finally { await rm(temp,{recursive:true,force:true}); }
});
