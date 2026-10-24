import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MASTERING_PRESETS, resolveMastering, getMasteringPreset } from '../shared/mastering.js';
import { analysisFilter, parseLoudness, masteringFilter, qualityReport } from '../server/mastering.mjs';
import { runFfmpeg } from '../server/media.mjs';
const preset = () => getMasteringPreset('youtube');
const log = (values={}) => JSON.stringify({input_i:'-24',input_tp:'-18',input_lra:'2',input_thresh:'-34',target_offset:'0',...values});
test('mastering settings validate presets and retain legacy normalization', () => {
 assert.equal(MASTERING_PRESETS.length,4);
 assert.ok(Object.isFrozen(MASTERING_PRESETS));
 assert.deepEqual(resolveMastering({normalize:true}),{enabled:true,preset:'podcast'});
 assert.deepEqual(resolveMastering({}),{enabled:false,preset:'youtube'});
 assert.deepEqual(resolveMastering({mastering:{enabled:true,preset:'reels'}}),{enabled:true,preset:'reels'});
 for(const mastering of [null,[],{}, {enabled:1,preset:'youtube'},{enabled:false,preset:'bad'}]) assert.throws(()=>resolveMastering({mastering}));
 assert.throws(()=>getMasteringPreset('bad'));
});
test('loudnorm parsing uses last measurement and preserves silence',()=>{
 assert.equal(parseLoudness(log()+'\n'+log({input_i:'-20'})).integratedLufs,-20);
 const silence=parseLoudness(log({input_i:'-inf',input_tp:'-inf',target_offset:'inf'}));
 assert.equal(silence.integratedLufs,null); assert.equal(silence.truePeakDbtp,null); assert.equal(silence.offsetDb,null);
 assert.equal(masteringFilter(preset(),silence),'anull');
 for(const value of ['', '{}', log({input_lra:'NaN'}), log({input_i:'oops'}),log({input_thresh:null})]) assert.throws(()=>parseLoudness(value));
});
test('filters provide measured two pass loudness and quality reports flag misses',()=>{
 const p=preset(), measurement=parseLoudness(log());
 assert.match(analysisFilter(p),/print_format=json/);
 assert.match(masteringFilter(p,measurement),/measured_I=-24/);
 assert.match(masteringFilter(p,measurement),/linear=true/);
 assert.match(masteringFilter(p,measurement),/TP=-2/);
 const after={...measurement,integratedLufs:-14,truePeakDbtp:-2};
 assert.equal(qualityReport(p,measurement,after).status,'passed');
 for(const change of [{integratedLufs:-18},{truePeakDbtp:0},{loudnessRangeLu:20},{integratedLufs:null}]) assert.equal(qualityReport(p,measurement,{...after,...change}).status,'review');
});
test('native two pass mastering measures encoded WAV and MP3 plus silence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mastering-'));
 try {
  const source=join(dir,'source.wav'),p=preset();
  await runFfmpeg(['-f','lavfi','-i','sine=frequency=997:duration=8:sample_rate=48000','-af','volume=0.2',source]);
  const analyze=async(path)=>parseLoudness((await runFfmpeg(['-loglevel','info','-i',path,'-af',analysisFilter(p),'-f','null','-'])).stderr);
  const before=await analyze(source);
  assert.ok(before.integratedLufs < -25);
  for(const ext of ['wav','mp3']) {
   const output=join(dir,`mastered.${ext}`);
   await runFfmpeg(['-i',source,'-af',masteringFilter(p,before),'-ar','48000',output]);
   const after=await analyze(output);
   assert.ok(Math.abs(after.integratedLufs-p.integratedLufs)<=1,JSON.stringify(after));
   assert.ok(after.truePeakDbtp<=p.truePeakDbtp+0.1,JSON.stringify(after));
   assert.equal(qualityReport(p,before,after).status,'passed');
  }
  const silent=join(dir,'silence.wav');
  await runFfmpeg(['-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','4',silent]);
  const measurement=await analyze(silent);
  assert.equal(measurement.integratedLufs,null);
  assert.equal(masteringFilter(p,measurement),'anull');
  assert.equal(qualityReport(p,measurement,measurement).status,'review');
 } finally {await rm(dir,{recursive:true,force:true});}
});
