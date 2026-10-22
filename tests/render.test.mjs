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
    await t.test('honors cancellation before processing', async () => {
      await assert.rejects(renderProject(project,{format:'wav',jobId:'cancelled'},{cancelled:()=>true}), RenderCancelled);
    });
    await t.test('removes partial exports when verification is interrupted', async () => {
      await assert.rejects(renderProject(project,{format:'wav',jobId:'interrupted'},{progress:(_,stage)=>{if(stage==='Checking the export') throw new RenderCancelled();}}), RenderCancelled);
      assert.ok(!(await readdir(join(dir,'exports'))).includes('render-interrupted.wav'));
    });
  } finally { await rm(temp,{recursive:true,force:true}); }
});
