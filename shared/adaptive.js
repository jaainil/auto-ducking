import { musicFadeAt } from './music.js';

export const ADAPTIVE_DEFAULTS = Object.freeze({
  adaptiveTargetGapDb: 10,
  adaptiveMinReductionDb: 2,
  adaptiveMaxReductionDb: 18,
  adaptiveHysteresisDb: 1,
  adaptiveMaxChangeDbPerSecond: 36,
});
const bound = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const setting = (s, key, fallback, lo, hi) => bound(Number.isFinite(Number(s[key])) ? Number(s[key]) : fallback, lo, hi);
const power = value => Number.isFinite(value) && value > 0 ? Math.min(value, 1e6) ** 2 : 0;

// Linear sliding maximum, with inclusive sample endpoints.
function maximum(values, before, after) {
  const result = new Float64Array(values.length);
  const deque = new Int32Array(values.length);
  let head = 0, tail = 0, next = 0;
  for (let i = 0; i < values.length; i++) {
    while (next < values.length && next <= i + after) {
      while (tail > head && values[deque[tail - 1]] <= values[next]) tail--;
      deque[tail++] = next++;
    }
    while (head < tail && deque[head] < i - before) head++;
    result[i] = values[deque[head]];
  }
  return result;
}

/** Relative music duck gain. Input RMS is raw, aligned, channel-averaged 20 ms RMS.
 * Base music gain is used in the level equation but must be applied separately.
 * All decisions run at 50 Hz; output rates interpolate the same dB curve.
 */
export function buildAdaptiveEnvelope(segments, settings = {}, duration, rate = 200, levels) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 600) throw new Error('Project duration must be positive and at most 600 seconds');
  if (!Number.isFinite(rate) || rate < 1 || rate > 1000) throw new Error('Envelope rate must be between 1 and 1000');
  const count = Math.ceil(duration * 50);
  const validArray = a => Array.isArray(a) || a instanceof Float32Array || a instanceof Float64Array;
  if (!levels || levels.hopMs !== 20 || !validArray(levels.voiceRms) || !validArray(levels.musicRms) || levels.voiceRms.length !== count || levels.musicRms.length !== count) throw new Error('Adaptive RMS profile requires aligned 20 ms voice and music arrays matching project duration');
  settings = settings || {};
  const cap = setting(settings, 'adaptiveMaxReductionDb', 18, 0, 60);
  const minimum = setting(settings, 'adaptiveMinReductionDb', 2, 0, cap);
  const gap = setting(settings, 'adaptiveTargetGapDb', 10, 0, 60);
  const base = setting(settings, 'baseMusicDb', -12, -60, 12);
  const hysteresis = setting(settings, 'adaptiveHysteresisDb', 1, 0, 12);
  const slew = setting(settings, 'adaptiveMaxChangeDbPerSecond', 36, 1, 120) / 50;
  const look = Math.round(setting(settings, 'lookAheadMs', 100, 0, 2000) / 20);
  const hold = Math.round(setting(settings, 'holdMs', 200, 0, 10000) / 20);
  const attack = setting(settings, 'fadeDownMs', 50, 1, 5000);
  const release = setting(settings, 'releaseMs', 500, 1, 10000);
  const fades = {musicFadeInMs:setting(settings,'musicFadeInMs',0,0,10000),musicFadeOutMs:setting(settings,'musicFadeOutMs',0,0,10000)};
  const diff = new Int32Array(count + 1);
  const overrides = [];
  for (const region of Array.isArray(segments) ? segments : []) {
    if (!region || region.enabled === false || !Number.isFinite(region.start) || !Number.isFinite(region.end) || region.end <= region.start) continue;
    const start = bound(Math.ceil(region.start * 50), 0, count);
    const end = bound(Math.ceil(region.end * 50), 0, count);
    if (end <= start) continue;
    diff[start]++; diff[end]--;
    if (region.reductionDb != null && Number.isFinite(Number(region.reductionDb))) overrides.push({start, end, value:bound(Number(region.reductionDb),0,cap)});
  }
  overrides.sort((a,b)=>a.start-b.start);
  // Max heap: overlapping explicit overrides take precedence over automatic levels.
  const heap = [];
  function push(item) { let i=heap.length;heap.push(item);while(i){const p=(i-1)>>1;if(heap[p].value>=item.value)break;heap[i]=heap[p];i=p;}heap[i]=item; }
  function pop() { const last=heap.pop();if(!heap.length)return;let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].value>heap[c].value)c++;if(heap[c].value<=last.value)break;heap[i]=heap[c];i=c;}heap[i]=last; }
  const targets = new Float64Array(count + 1);
  let voicePower=0, musicPower=0, active=0, nextOverride=0;
  for(let i=0;i<count;i++) {
    voicePower+=power(levels.voiceRms[i]); musicPower+=power(levels.musicRms[i]);
    if(i>=5){voicePower-=power(levels.voiceRms[i-5]);musicPower-=power(levels.musicRms[i-5]);}
    active+=diff[i];
    while(nextOverride<overrides.length&&overrides[nextOverride].start<=i)push(overrides[nextOverride++]);
    while(heap.length&&heap[0].end<=i)pop();
    const window=Math.min(5,i+1);
    const v=Math.sqrt(Math.max(0,voicePower)/window);
    const m=Math.sqrt(Math.max(0,musicPower)/window)*musicFadeAt(i/50,duration,fades);
    if(active>0&&v>=10**(-55/20)) targets[i]=heap.length?heap[0].value:bound(20*Math.log10(Math.max(1e-12,m)/v)+base+gap,minimum,cap);
  }
  const anticipated=maximum(targets,0,look);
  const held=maximum(anticipated,hold,0);
  const curve=new Float64Array(count+1);
  let accepted=0;
  for(let i=1;i<curve.length;i++) {
    const target=held[i];
    if(target===0||accepted===0||Math.abs(target-accepted)>=hysteresis)accepted=target;
    const previous=curve[i-1];
    const tau=accepted>previous?attack:release;
    const step=(accepted-previous)*(1-Math.exp(-20/tau));
    curve[i]=bound(previous+bound(step,-slew,slew),0,cap);
  }
  const result=new Float32Array(Math.ceil(duration*rate));
  for(let i=0;i<result.length;i++){const position=i*50/rate;const left=Math.floor(position);const mix=position-left;result[i]=10**(-(curve[left]*(1-mix)+curve[Math.min(left+1,count)]*mix)/20);}
  return result;
}
