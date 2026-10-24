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
    await t.test('adaptive Rust automation follows fitted source levels and matches exported music', async () => {
      const {getAdaptiveLevels}=await import('../server/adaptive-levels.mjs');
      const {adaptiveEnvelope}=await import('../server/adaptive-engine.mjs');
      const {NEW_PROJECT_SETTINGS}=await import('../shared/ducking-settings.js');
      await runFfmpeg(['-f','lavfi','-i','aevalsrc=0.1*sin(2*PI*220*t):s=48000:d=4',join(dir,'adaptive-voice.wav')]);
      await runFfmpeg(['-f','lavfi','-i','aevalsrc=if(lt(t\\,2)\\,0.03\\,0.3)*sin(2*PI*440*t):s=48000:d=4',join(dir,'adaptive-music.wav')]);
      const adaptive={...project,media:{video:null,voiceWav:'adaptive-voice.wav',music:'adaptive-music.wav'},source:{music:{duration:4}},settings:{...NEW_PROJECT_SETTINGS},segments:[{start:0,end:4,enabled:true}]};
      const levels=await getAdaptiveLevels(adaptive);
      assert.equal(levels.voiceRms.length,200);
      const curve=await adaptiveEnvelope(adaptive.segments,adaptive.settings,4,1000,levels);
      assert.ok(curve[3000]<curve[1000]-.3,'louder music should receive more reduction');
      const output=await renderProject(adaptive,{format:'wav',jobId:'adaptive-parity',mastering:{enabled:false,preset:'youtube'}});
      const samples=await decodePcm16k(join(dir,'exports',output.file));
      const amplitude=(time)=>{let sine=0,cosine=0;for(let i=time*16000;i<(time+.1)*16000;i++){const phase=2*Math.PI*440*i/16000;sine+=samples[i]*Math.sin(phase);cosine+=samples[i]*Math.cos(phase);}return 2*Math.hypot(sine,cosine)/1600;};
      for(const [time,source] of [[1,.03],[3,.3]]) {
        // Native mono sources are panned to stereo at equal power before mixing.
        const expected=source*Math.SQRT1_2*10**(-8/20)*curve[time*1000];
        assert.ok(Math.abs(amplitude(time)-expected)<.0005,`${time}: measured ${amplitude(time)} vs ${expected}`);
      }
      const selected={...adaptive,settings:{...adaptive.settings,musicStartSeconds:2,musicEndSeconds:3,loopCrossfadeMs:100}};
      const trimmed=await getAdaptiveLevels(selected);
      assert.ok(trimmed.musicRms[75]>levels.musicRms[75]*5,'analysis must follow the selected loud section');
      assert.ok(!(await readdir(dir)).some(name=>name.startsWith('adaptive-music-')));
    });
    for (const preset of ['reels','youtube','podcast','advertisements']) {
      await t.test(`masters the final mix using the ${preset} recommendation`, async () => {
        const output = await renderProject(project,{format:'wav',jobId:`master-${preset}`,mastering:{enabled:true,preset}});
        assert.equal(output.mastering.preset,preset);
        assert.equal(output.normalize,true);
        assert.ok(Math.abs(output.mastering.after.integratedLufs-output.mastering.targets.integratedLufs)<=1);
        assert.ok(output.mastering.after.truePeakDbtp<=output.mastering.targets.truePeakDbtp+.1);
        assert.ok(output.mastering.before.integratedLufs < output.mastering.after.integratedLufs);
        assert.equal(output.mastering.status,'passed');
      });
    }
    await t.test('checks the encoded MP3 and MP4, retaining the chosen preset', async () => {
      for (const format of ['mp3','mp4']) {
        const output=await renderProject(project,{format,jobId:`master-${format}`,mastering:{enabled:true,preset:'youtube'}});
        assert.ok(output.mastering.after.truePeakDbtp<=-1.4);
        assert.ok(Math.abs(output.mastering.after.integratedLufs+14)<=1);
        assert.equal(output.mastering.preset,'youtube');
      }
    });
    await t.test('silent mixes receive an honest review result without nonfinite JSON', async () => {
      const silent={...project,media:{...project.media,music:'voice.wav'}};
      const output=await renderProject(silent,{format:'wav',jobId:'master-silence',mastering:{enabled:true,preset:'podcast'}});
      assert.equal(output.mastering.status,'review');
      assert.equal(output.mastering.after.integratedLufs,null);
      assert.equal(output.mastering.after.truePeakDbtp,null);
      assert.ok(!JSON.stringify(output).includes('Infinity'));
    });
    await t.test('rejects unknown mastering presets before producing an export', async () => {
      await assert.rejects(renderProject(project,{format:'wav',jobId:'invalid-master',mastering:{enabled:true,preset:'unknown'}}),/preset/i);
    });
    await t.test('cancels loudness analysis and removes temporary files', async () => {
      let analysing=false,cancelled=false;
      await assert.rejects(renderProject(project,{format:'wav',jobId:'master-cancel',mastering:{enabled:true,preset:'youtube'}},{
        progress:(_,stage)=>{analysing=stage==='Analyzing mix loudness';},
        onChild:child=>{if(child&&analysing){cancelled=true;child.kill('SIGTERM');}},
        cancelled:()=>cancelled,
      }),RenderCancelled);
      assert.ok(!(await readdir(dir)).some(name=>name.includes('master-cancel')));
      assert.ok(!(await readdir(join(dir,'exports'))).some(name=>name.includes('master-cancel')));
    });
    for (const [stage, start, id] of [['Analyzing mix loudness',8,'analysis-callback'],['Checking mastered audio',80,'quality-callback']]) {
      await t.test(`cancellation from ${stage.toLowerCase()} progress cleans up safely`, async () => {
        await assert.rejects(renderProject(project,{format:'wav',jobId:id,mastering:{enabled:true,preset:'youtube'}},{
          progress:(percent,current)=>{if(current===stage&&percent>start)throw new RenderCancelled();},
        }),RenderCancelled);
        assert.ok(!(await readdir(dir)).some(name=>name.includes(id)));
        assert.ok(!(await readdir(join(dir,'exports'))).some(name=>name.includes(id)));
      });
    }
    await t.test('removes partial exports when verification is interrupted', async () => {
      await assert.rejects(renderProject(project,{format:'wav',jobId:'interrupted'},{progress:(_,stage)=>{if(stage==='Checking the export') throw new RenderCancelled();}}), RenderCancelled);
      assert.ok(!(await readdir(join(dir,'exports'))).includes('render-interrupted.wav'));
    });
  } finally { await rm(temp,{recursive:true,force:true}); }
});
