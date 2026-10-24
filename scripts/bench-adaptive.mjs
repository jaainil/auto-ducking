import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createAdaptiveEngine } from '../shared/adaptive-wasm.js';
import { buildAdaptiveEnvelope } from '../shared/adaptive.js';
import { NEW_PROJECT_SETTINGS } from '../shared/ducking-settings.js';
const start=performance.now();
const engine=await createAdaptiveEngine(await readFile(new URL('../public/wasm/adaptive_ducking.wasm',import.meta.url)));
const initializeMs=performance.now()-start;
const results=[];
for(const duration of [30,300,600]) {
 const levels={hopMs:20,voiceRms:Array.from({length:duration*50},(_,i)=>.04+.02*Math.sin(i/70)),musicRms:Array.from({length:duration*50},(_,i)=>.08+.07*Math.sin(i/120))};
 const segments=Array.from({length:Math.ceil(duration/8)},(_,i)=>({start:i*8,end:Math.min(duration,i*8+6)}));
 const row={durationSeconds:duration};
 for(const [name,build] of [['javascript',buildAdaptiveEnvelope],['rustWasm',engine.buildEnvelope]]) {
  for(let i=0;i<5;i++)build(segments,NEW_PROJECT_SETTINGS,duration,200,levels);
  const times=[];
  for(let i=0;i<9;i++){const t=performance.now();build(segments,NEW_PROJECT_SETTINGS,duration,200,levels);times.push(performance.now()-t);}
  row[`${name}MedianMs`]=+times.sort((a,b)=>a-b)[4].toFixed(3);
 }
 row.speedup=+(row.javascriptMedianMs/row.rustWasmMedianMs).toFixed(2);
 results.push(row);
}
console.log(JSON.stringify({initializeMs:+initializeMs.toFixed(3),trials:9,results,note:'Decision/envelope calculation only; WASM timing includes input/output copies. Excludes decoding, RMS, worker messages, network and export. App media limit is ten minutes.'},null,2));
