//! Dependency-free adaptive RMS ducking, shared by browser and server through WASM.
//! ABI settings: duration, rate, hopMs, gap, minimum, maximum, base, hysteresis,
//! slew dB/sec, lookAheadMs, holdMs, attackMs, releaseMs, fadeInMs, fadeOutMs.
//! Segments: [startSeconds, endSeconds, enabled, overrideDb (-1 = automatic)].
//! All buffers are f64 allocations owned by this module. Output contains linear
//! relative gains (base gain remains the responsibility of the mixer).
use std::{cell::RefCell, collections::{HashMap, BinaryHeap, VecDeque}, cmp::Ordering};
thread_local! { static BUFFERS: RefCell<HashMap<usize, Box<[f64]>>> = RefCell::new(HashMap::new()); }
const MAX_BUFFER: usize = 600_000;
#[no_mangle]
pub extern "C" fn alloc_f64(count: usize) -> usize {
    if count == 0 || count > MAX_BUFFER { return 0; }
    let mut data = vec![0.0; count].into_boxed_slice();
    let ptr = data.as_mut_ptr() as usize;
    BUFFERS.with(|b| b.borrow_mut().insert(ptr, data));
    ptr
}
#[no_mangle]
pub extern "C" fn dealloc_f64(ptr: usize, _count: usize) {
    BUFFERS.with(|b| b.borrow_mut().remove(&ptr));
}
fn clamp(x:f64, lo:f64, hi:f64)->f64 { x.max(lo).min(hi) }
fn setting(x:f64, fallback:f64, lo:f64, hi:f64)->f64 {clamp(if x.is_finite(){x}else{fallback},lo,hi)}
fn power(x:f64)->f64 {if x.is_finite()&&x>0.0{x.min(1e6).powi(2)}else{0.0}}
fn maximum(values:&[f64],before:usize,after:usize)->Vec<f64>{
    let mut result=vec![0.0;values.len()];let mut queue:VecDeque<usize>=VecDeque::new();let mut next=0;
    for (i,out) in result.iter_mut().enumerate(){
        while next<values.len()&&next<=i+after {while queue.back().is_some_and(|&j|values[j]<=values[next]){queue.pop_back();}queue.push_back(next);next+=1;}
        while queue.front().is_some_and(|&j|j<i.saturating_sub(before)){queue.pop_front();}
        *out=values[*queue.front().unwrap()];
    }result
}
#[derive(Clone,Copy)]
struct Override {start:usize,end:usize,value:f64}
impl PartialEq for Override {fn eq(&self,o:&Self)->bool{self.value==o.value}}
impl Eq for Override {}
impl PartialOrd for Override {fn partial_cmp(&self,o:&Self)->Option<Ordering>{Some(self.cmp(o))}}
impl Ord for Override {fn cmp(&self,o:&Self)->Ordering{self.value.total_cmp(&o.value)}}
fn calculate(voice:&[f64],music:&[f64],segments:&[f64],s:&[f64],out_count:usize)->Result<Vec<f64>,i32>{
    if s.len()!=15{return Err(1)}
    let (duration,rate)=(s[0],s[1]);
    if !duration.is_finite()||duration<=0.0||duration>600.0||!rate.is_finite()||!(1.0..=1000.0).contains(&rate)||s[2]!=20.0{return Err(2)}
    let count=(duration*50.0).ceil() as usize;
    if count>30000||voice.len()!=count||music.len()!=count||out_count!=(duration*rate).ceil() as usize||segments.len()%4!=0||segments.len()>MAX_BUFFER{return Err(3)}
    let cap=setting(s[5],18.0,0.0,60.0);let minimum=setting(s[4],2.0,0.0,cap);
    let gap=setting(s[3],10.0,0.0,60.0);let base=setting(s[6],-12.0,-60.0,12.0);
    let hysteresis=setting(s[7],1.0,0.0,12.0);let slew=setting(s[8],36.0,1.0,120.0)/50.0;
    let look=(setting(s[9],100.0,0.0,2000.0)/20.0).round() as usize;
    let hold=(setting(s[10],200.0,0.0,10000.0)/20.0).round() as usize;
    let attack=setting(s[11],50.0,1.0,5000.0);let release=setting(s[12],500.0,1.0,10000.0);
    let fade_in=setting(s[13],0.0,0.0,10000.0)/1000.0;let fade_out=setting(s[14],0.0,0.0,10000.0)/1000.0;
    let mut diff=vec![0i32;count+1];let mut overrides=Vec::new();
    for r in segments.chunks_exact(4){
        if r[2]==0.0||!r[0].is_finite()||!r[1].is_finite()||r[1]<=r[0]{continue}
        let start=clamp((r[0]*50.0).ceil(),0.0,count as f64) as usize;let end=clamp((r[1]*50.0).ceil(),0.0,count as f64) as usize;
        if end<=start{continue}diff[start]+=1;diff[end]-=1;
        if r[3].is_finite()&&r[3]>=0.0{overrides.push(Override{start,end,value:clamp(r[3],0.0,cap)})}
    }
    overrides.sort_by_key(|r|r.start);
    let mut heap=BinaryHeap::<Override>::new();let mut targets=vec![0.0;count+1];
    let(mut vp,mut mp,mut active,mut next)=(0.0,0.0,0,0);
    for i in 0..count{
        vp+=power(voice[i]);mp+=power(music[i]);if i>=5{vp-=power(voice[i-5]);mp-=power(music[i-5]);}
        active+=diff[i];while next<overrides.len()&&overrides[next].start<=i{heap.push(overrides[next]);next+=1;}
        while heap.peek().is_some_and(|r|r.end<=i){heap.pop();}
        let window=(i+1).min(5) as f64;let v=(vp.max(0.0)/window).sqrt();let time=i as f64/50.0;
        let fade=if fade_in>0.0{clamp(time/fade_in,0.0,1.0)}else{1.0}*if fade_out>0.0{clamp((duration-time)/fade_out,0.0,1.0)}else{1.0};
        let m=(mp.max(0.0)/window).sqrt()*fade;
        if active>0&&v>=0.0017782794100389228{targets[i]=heap.peek().map_or_else(||clamp(20.0*(m.max(1e-12)/v).log10()+base+gap,minimum,cap),|r|r.value);}
    }
    let held=maximum(&maximum(&targets,0,look),hold,0);let mut curve=vec![0.0;count+1];let mut accepted:f64=0.0;
    for i in 1..curve.len(){let target=held[i];if target==0.0||accepted==0.0||(target-accepted).abs()>=hysteresis{accepted=target;}
        let previous=curve[i-1];let tau=if accepted>previous{attack}else{release};let step=(accepted-previous)*(1.0-(-20.0/tau).exp());curve[i]=clamp(previous+clamp(step,-slew,slew),0.0,cap);
    }
    // At production rates each 20 ms interval contains exactly 4 or 20
    // samples. Decibel interpolation is a geometric progression in gain:
    // compute two powers per interval rather than one power per output sample.
    // Restart from the canonical gain every interval to prevent drift.
    if rate == 200.0 || rate == 1000.0 {
        let stride = (rate / 50.0) as usize;
        let mut output = vec![0.0; out_count];
        for left in 0..count {
            let start = left * stride;
            if start >= out_count { break; }
            let end = (start + stride).min(out_count);
            let mut gain = 10f64.powf(-curve[left] / 20.0);
            let ratio = 10f64.powf(-(curve[left + 1] - curve[left]) / (20.0 * stride as f64));
            for sample in &mut output[start..end] {
                *sample = gain;
                gain *= ratio;
            }
        }
        return Ok(output);
    }
    Ok((0..out_count).map(|i|{let position=i as f64*50.0/rate;let left=position.floor() as usize;let mix=position-left as f64;10f64.powf(-(curve[left]*(1.0-mix)+curve[(left+1).min(count)]*mix)/20.0)}).collect())
}
/// Status: 0 success; 1 unknown/incorrect allocation; 2 invalid time/rate/hop;
/// 3 inconsistent profile, segment, or output size. Never dereferences raw pointers.
#[no_mangle]
pub extern "C" fn generate_envelope(voice:usize,music:usize,count:usize,segments:usize,segment_count:usize,settings:usize,output:usize,output_count:usize)->i32{
    if count>30000||segment_count>MAX_BUFFER/4||output_count>MAX_BUFFER{return 3}
    BUFFERS.with(|buffers|{
        let mut buffers=buffers.borrow_mut();
        let result={
            let Some(v)=buffers.get(&voice) else{return 1};let Some(m)=buffers.get(&music) else{return 1};let Some(s)=buffers.get(&settings) else{return 1};
            let regions=if segment_count==0{&[][..]}else{let Some(r)=buffers.get(&segments) else{return 1};if r.len()!=segment_count*4{return 1}r.as_ref()};
            if v.len()!=count||m.len()!=count||s.len()!=15{return 1}
            calculate(v,m,regions,s,output_count)
        };
        match result{Err(code)=>code,Ok(values)=>{let Some(out)=buffers.get_mut(&output) else{return 1};if out.len()!=output_count{return 1}out.copy_from_slice(&values);0}}
    })
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn worked_example(){let s=[5.0,200.0,20.0,10.0,2.0,18.0,-8.0,0.0,36.0,0.0,200.0,50.0,500.0,0.0,0.0];let result=calculate(&vec![0.1;250],&vec![10f64.powf(-13.0/20.0);250],&[0.0,5.0,1.0,-1.0],&s,1000).unwrap();assert!((-20.0*result[800].log10()-9.0).abs()<0.01);}
    #[test]
    fn production_resampling_matches_decibel_interpolation() {
        let mut settings = [5.0, 50.0, 20.0, 10.0, 2.0, 18.0, -8.0, 0.0, 36.0, 100.0, 200.0, 50.0, 500.0, 500.0, 1000.0];
        let voice = vec![0.1; 250];
        let music: Vec<f64> = (0..250).map(|i| 10f64.powf((-13.0 + (i as f64 / 13.0).sin() * 7.0) / 20.0)).collect();
        let regions = [0.7, 3.0, 1.0, -1.0];
        let canonical = calculate(&voice, &music, &regions, &settings, 250).unwrap();
        for rate in [200.0, 1000.0] {
            settings[1] = rate;
            let output = calculate(&voice, &music, &regions, &settings, (5.0 * rate) as usize).unwrap();
            let stride = (rate / 50.0) as usize;
            for i in 0..249 * stride {
                let left = i / stride;
                let mix = (i % stride) as f64 / stride as f64;
                let expected = 10f64.powf(canonical[left].log10() * (1.0 - mix) + canonical[left + 1].log10() * mix);
                assert!((output[i] - expected).abs() < 1e-13);
            }
        }
    }
    #[test]fn invalid_pointer_is_rejected(){assert_eq!(generate_envelope(1,2,3,4,0,5,6,7),1);dealloc_f64(123,999);assert_eq!(alloc_f64(MAX_BUFFER+1),0);}
}
