import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewAudio } from '../src/lib/audioEngine.ts';

// Firefox retains an already-started value curve when cancellation is after
// its start. A new event inside that curve throws InvalidStateError.
class GainParam {
  value = 1;
  events = [];
  cancelScheduledValues(time) { this.events = this.events.filter(event => event.time < time); }
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
  const gain = new GainParam();
  const sources = [];
  const context = {currentTime:1,resume:async()=>{},createBufferSource:()=>{
    const source = {connect(){},start(...args){this.started=args;},stop(){this.stopped=true;},disconnect(){}};
    sources.push(source);
    return source;
  }};
  // TypeScript private fields compile to ordinary properties; exercise the real
  // public transport and automation with strict AudioParam scheduling semantics.
  Object.assign(engine,{context,musicGain:{gain},voiceGain:{},voiceBuffer:{duration:10},musicBuffer:{duration:3},duration:10});
  engine.setAutomation(new Float32Array(2000).fill(.25),-12,false);
  return {engine,gain,context,sources};
}
test('changing ducking settings and bypass mid-play removes the active curve', async () => {
  const {engine,gain,context}=player();
  await engine.play();
  context.currentTime=2;
  assert.doesNotThrow(()=>engine.setAutomation(new Float32Array(2000).fill(.1),-18,false));
  context.currentTime=2.01;
  assert.doesNotThrow(()=>engine.setAutomation(new Float32Array(2000).fill(.1),-18,true));
  assert.equal(gain.events.filter(e=>e.kind==='curve').length,1);
  assert.ok(Math.abs(gain.events.find(e=>e.kind==='curve').values.at(-1)-10**(-18/20))<1e-6);
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
