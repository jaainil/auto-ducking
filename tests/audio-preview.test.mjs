import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewAudio } from '../src/lib/audioEngine.ts';

// Reproduce the reported Firefox behavior: cancellation time is clamped to
// the current clock, leaving the old curve present. Inserting into it throws.
class GainParam {
  value = 1;
  events = [];
  constructor(clock = () => 0) { this.clock = clock; }
  cancelScheduledValues(time) {
    const effectiveTime = Math.max(time, this.clock());
    this.events = this.events.filter(event => event.time < effectiveTime);
  }
  setValueAtTime(value,time) {
    if(this.events.some(event => event.kind === 'curve' && time > event.time && time < event.time + event.duration)) {
      throw new DOMException("Can't add events during a curve event", 'InvalidStateError');
    }
    this.value=value;
    this.events.push({kind:'value',time,value});
  }
  linearRampToValueAtTime(value,time) {this.setValueAtTime(value,time);}
  setValueCurveAtTime(values,time,duration) {
    if(this.events.some(event => event.kind === 'curve' && time < event.time+event.duration && time+duration > event.time)) throw new DOMException('Overlapping curves','InvalidStateError');
    this.events.push({kind:'curve',time,duration,values});
  }
}
function player() {
  const engine = new PreviewAudio();
  const sources = [];
  const gainNodes = [];
  const context = {createBuffer:(channels,length,sampleRate)=>{ const data=Array.from({length:channels},()=>new Float32Array(length)); return {numberOfChannels:channels,length,sampleRate,duration:length/sampleRate,getChannelData:index=>data[index]}; },currentTime:1,destination:{},resume:async()=>{},createGain:()=>{
    const node = {gain:new GainParam(()=>context.currentTime),connect(){},disconnect(){this.disconnected=true;}};
    gainNodes.push(node);
    return node;
  },createBufferSource:()=>{
    const source = {connect(){},start(...args){this.started=args;},stop(){this.stopped=true;},disconnect(){}};
    sources.push(source);
    return source;
  }};
  // TypeScript private fields compile to ordinary properties; exercise the real
  // public transport and automation with strict AudioParam scheduling semantics.
  const musicGain = context.createGain();
  const gain = musicGain.gain;
  Object.assign(engine,{context,musicGain,voiceGain:context.createGain(),musicMonitor:context.createGain(),voiceBuffer:{duration:10},musicBuffer:{duration:3},duration:10});
  engine.setAutomation(new Float32Array(2000).fill(.25),-12,false);
  return {engine,gain,context,sources,gainNodes};
}
test('changing ducking settings and bypass mid-play removes the active curve', async () => {
  const {engine,context,gainNodes}=player();
  await engine.play();
  context.currentTime=2;
  assert.doesNotThrow(()=>engine.setAutomation(new Float32Array(2000).fill(.1),-18,false));
  context.currentTime=2.01;
  assert.doesNotThrow(()=>engine.setAutomation(new Float32Array(2000).fill(.1),-18,true));
  const active = engine.musicGain.gain;
  assert.equal(active.events.filter(e=>e.kind==='curve').length,1);
  assert.ok(gainNodes.length >= 4, 'each replacement gets an uncontaminated AudioParam');
  assert.ok(Math.abs(active.events.find(e=>e.kind==='curve').values.at(-1)-10**(-18/20))<1e-6);
});
test('pause, seek and replay discard stale gain curves', async () => {
  const {engine,context}=player();
  await engine.play();
  context.currentTime=2;
  assert.doesNotThrow(()=>engine.pause());
  engine.seek(4);
  await assert.doesNotReject(()=>engine.play());
  context.currentTime=3;
  assert.doesNotThrow(()=>engine.setAutomation(new Float32Array(2000).fill(.25),-12,false));
});

test('trimmed preview loops and seeks inside the selection without restarting dialogue', async () => {
  const {engine,context,sources}=player();
  const channel = new Float32Array(48000);
  channel.fill(.5,16000,32000);
  engine.musicBuffer = {duration:3,sampleRate:16000,getChannelData:()=>channel};
  await engine.play();
  context.currentTime=2;
  const musicPeaks = engine.setMusicTrim(1,2);
  assert.equal(sources.length,3, 'only the music should restart');
  assert.equal(sources[0].stopped,undefined, 'dialogue continues');
  assert.equal(sources[1].stopped,true);
  assert.equal(sources[2].loopStart,1);
  assert.equal(sources[2].loopEnd,2);
  assert.ok(sources[2].started[1]>=1 && sources[2].started[1]<2);
  assert.ok(musicPeaks.max.every(value=>value===.5), 'waveform repeats the chosen section across the full project');
  engine.pause();
  await engine.play(7.5);
  assert.equal(sources.at(-1).started[1],1.5);
});

// Seeks and live changes inside the initial scheduling lead must retain position.
test('changing automation immediately after a seek preserves the seek position', async () => {
  const {engine}=player();
  await engine.play(5);
  assert.equal(engine.currentTime,5);
  assert.doesNotThrow(()=>engine.setAutomation(new Float32Array(2000).fill(.2),-12,true));
  assert.equal(engine.currentTime,5);
});


test('smooth loops use one bounded cycle, preserve dialogue and seek phase', async () => {
  const {engine,context,sources}=player();
  const channel=Float32Array.from({length:300},(_,i)=>i/300);
  engine.musicBuffer={duration:3,sampleRate:100,numberOfChannels:1,getChannelData:()=>channel};
  await engine.play();
  context.currentTime=2;
  engine.setMusicSettings({musicStartSeconds:1,musicEndSeconds:2,loopCrossfadeMs:200,musicFadeInMs:1000,musicFadeOutMs:2000});
  assert.equal(sources[0].stopped,undefined);
  assert.equal(engine.fittedBuffer.length,80);
  assert.ok(Math.abs(engine.fittedBuffer.getChannelData(0)[0]-.6)<1e-6);
  engine.pause();
  await engine.play(7.5);
  assert.ok(Math.abs(sources.at(-1).started[1]-.3)<1e-6);
  engine.setAutomation(new Float32Array(2000).fill(.1),0,true);
  assert.equal(engine.gainAt(0),0);
  assert.equal(engine.gainAt(10),0);
  assert.equal(engine.gainAt(5),1,'Original bypasses ducking but preserves project fades');
});

test('monitor solo and mute change audition gain without restarting sources', async()=>{
 const {engine,sources}=player();
 await engine.play();
 engine.setMonitor({voiceMuted:false,musicMuted:false,voiceSolo:true,musicSolo:false});
 assert.equal(engine.voiceGain.gain.value,1);
 assert.equal(engine.musicMonitor.gain.value,0);
 engine.setMonitor({voiceMuted:false,musicMuted:true,voiceSolo:true,musicSolo:true});
 assert.equal(engine.musicMonitor.gain.value,0,'mute wins when both stems solo');
 assert.equal(sources.length,2);
 assert.ok(sources.every(source=>!source.stopped));
});

test('long selected songs materialize only the timeline prefix and seek without looping', async()=>{
 const {engine,context,sources}=player();
 engine.duration=30;
 engine.voiceBuffer={duration:30};
 const channel=Float32Array.from({length:12000},(_,i)=>i/12000);
 engine.musicBuffer={duration:1200,sampleRate:10,numberOfChannels:1,getChannelData:()=>channel};
 let allocations=0;
 const createBuffer=context.createBuffer;
 context.createBuffer=(...args)=>{allocations++;return createBuffer(...args);};
 engine.setMusicSettings({loopCrossfadeMs:1000});
 assert.equal(engine.fittedBuffer.length,300,'buffer allocation is capped to project frames');
 assert.ok(engine.fittedBuffer.getChannelData(0)[0]>.99,'prefix retains tail/head overlap at project start');
 const fitted=engine.fittedBuffer;
 engine.setMusicSettings({loopCrossfadeMs:1000,musicFadeInMs:2000});
 assert.equal(engine.fittedBuffer,fitted,'fade changes do not rebuild fitted audio');
 assert.equal(allocations,1);
 await engine.play(21.5);
 assert.equal(sources.at(-1).loop,false);
 assert.equal(sources.at(-1).started[1],21.5);
});
