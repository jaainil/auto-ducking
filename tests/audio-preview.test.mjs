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
  const context = {currentTime:1,resume:async()=>{},createBufferSource:()=>({connect(){},start(){},stop(){},disconnect(){}})};
  // TypeScript private fields compile to ordinary properties; exercise the real
  // public transport and automation with strict AudioParam scheduling semantics.
  Object.assign(engine,{context,musicGain:{gain},voiceGain:{},voiceBuffer:{duration:10},musicBuffer:{duration:3},duration:10});
  engine.setAutomation(new Float32Array(2000).fill(.25),-12,false);
  return {engine,gain,context};
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
