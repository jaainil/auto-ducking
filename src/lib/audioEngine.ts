import { dbToGain, envelopeAt } from "../../shared/envelope.js";
import { resolveMusicTrim, musicOffsetAt, resolveMusicFit, musicFadeAt, fittedMusicSample } from "../../shared/music.js";
import type { Peaks } from "../types";

const PEAK_BUCKETS = 2200;

function peaksFor(
  buffer: AudioBuffer,
  duration: number,
  buckets: number,
  loop: boolean,
  trimStart = 0,
  trimEnd = buffer.duration,
): Peaks["voice"] {
  const channel = buffer.getChannelData(0);
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  const secondsPerBucket = duration / buckets;
  const samplesPerBucket = secondsPerBucket * buffer.sampleRate;
  const stride = Math.max(1, Math.floor(samplesPerBucket / 140));
  const first = Math.round(trimStart * buffer.sampleRate);
  const loopLength = Math.max(1, Math.round((trimEnd - trimStart) * buffer.sampleRate));

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = Math.floor(bucket * samplesPerBucket);
    const end = Math.ceil((bucket + 1) * samplesPerBucket);
    let low = 0;
    let high = 0;

    if (start >= channel.length && !loop) {
      min[bucket] = 0;
      max[bucket] = 0;
      continue;
    }

    if (loop && channel.length > 0) {
      const span = Math.max(1, end - start);
      for (let offset = 0; offset < span; offset += stride) {
        const value = channel[first + (start + offset) % loopLength] ?? 0;
        if (value < low) low = value;
        if (value > high) high = value;
      }
    } else {
      for (let index = start; index < Math.min(end, channel.length); index += stride) {
        const value = channel[index] ?? 0;
        if (value < low) low = value;
        if (value > high) high = value;
      }
    }

    min[bucket] = low;
    max[bucket] = high;
  }

  return { min, max };
}

export interface AudioLoadResult {
  peaks: Peaks;
  voiceDuration: number;
  musicDuration: number;
  sourceMusic: Peaks["music"];
}

export class PreviewAudio {
  private context: AudioContext | null = null;
  private voiceBuffer: AudioBuffer | null = null;
  private musicBuffer: AudioBuffer | null = null;
  private voiceSource: AudioBufferSourceNode | null = null;
  private fittedBuffer: AudioBuffer | null = null;
  private fittedLoop = true;
  private musicSettings: Record<string, number> = {};
  private monitor = { voiceMuted: false, musicMuted: false, voiceSolo: false, musicSolo: false };
  private musicMonitor: GainNode | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  private voiceGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;

  private envelope: Float32Array = new Float32Array([1]);
  private envelopeRate = 200;
  private baseDb = -12;
  private bypass = false;
  private duration = 0;
  private musicTrim = { start: 0, end: 0, length: 0 };

  private playing = false;
  private startedAt = 0;
  private startOffset = 0;
  private pausedAt = 0;
  private playToken = 0;

  get loaded() {
    return Boolean(this.voiceBuffer && this.musicBuffer);
  }

  get isPlaying() {
    return this.playing;
  }

  get currentTime() {
    if (!this.playing || !this.context) return this.pausedAt;
    return Math.min(
      this.duration,
      this.startOffset + Math.max(0, this.context.currentTime - this.startedAt),
    );
  }

  get audioContext() {
    return this.context;
  }

  private ensureContext() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.limiter = this.context.createDynamicsCompressor();
      this.limiter.threshold.value = -1.5;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.002;
      this.limiter.release.value = 0.18;
      this.limiter.connect(this.context.destination);

      this.voiceGain = this.context.createGain();
      this.voiceGain.gain.value = 1;
      this.voiceGain.connect(this.limiter);

      this.musicGain = this.context.createGain();
      this.musicGain.gain.value = 1;
      this.musicMonitor = this.context.createGain();
      this.musicMonitor.connect(this.limiter);
      this.musicGain.connect(this.musicMonitor);
    }
    return this.context;
  }

  async load(
    urls: { voice: string; music: string },
    duration: number,
  ): Promise<AudioLoadResult> {
    const context = this.ensureContext();
    this.duration = duration;
    this.stopSources();
    this.playing = false;
    this.pausedAt = 0;

    const [voiceData, musicData] = await Promise.all([
      fetch(urls.voice).then((response) => {
        if (!response.ok) throw new Error("The voice preview could not be loaded.");
        return response.arrayBuffer();
      }),
      fetch(urls.music).then((response) => {
        if (!response.ok) throw new Error("The music preview could not be loaded.");
        return response.arrayBuffer();
      }),
    ]);

    const [voiceBuffer, musicBuffer] = await Promise.all([
      context.decodeAudioData(voiceData.slice(0)),
      context.decodeAudioData(musicData.slice(0)),
    ]);

    this.voiceBuffer = voiceBuffer;
    this.musicBuffer = musicBuffer;
    this.fittedBuffer = null;
    this.musicSettings = {};
    this.musicTrim = resolveMusicTrim({}, musicBuffer.duration);

    return {
      voiceDuration: voiceBuffer.duration,
      musicDuration: musicBuffer.duration,
      sourceMusic: peaksFor(musicBuffer, musicBuffer.duration, PEAK_BUCKETS, false),
      peaks: {
        buckets: PEAK_BUCKETS,
        voice: peaksFor(voiceBuffer, duration, PEAK_BUCKETS, false),
        music: peaksFor(musicBuffer, duration, PEAK_BUCKETS, true),
      },
    };
  }

  setAutomation(
    envelope: Float32Array,
    baseDb: number,
    bypass: boolean,
    rate = 200,
  ) {
    this.envelope = envelope;
    this.baseDb = baseDb;
    this.bypass = bypass;
    this.envelopeRate = rate;
    if (this.playing) this.reschedule();
  }

  setMonitor(monitor: { voiceMuted: boolean; musicMuted: boolean; voiceSolo: boolean; musicSolo: boolean }) {
    this.monitor = monitor;
    const solo = monitor.voiceSolo || monitor.musicSolo;
    if (this.voiceGain) this.voiceGain.gain.value = !monitor.voiceMuted && (!solo || monitor.voiceSolo) ? 1 : 0;
    if (this.musicMonitor) this.musicMonitor.gain.value = !monitor.musicMuted && (!solo || monitor.musicSolo) ? 1 : 0;
  }

  setMusicTrim(start: number, end: number) {
    return this.setMusicSettings({ ...this.musicSettings, musicStartSeconds: start, musicEndSeconds: end });
  }

  setMusicSettings(settings: { musicStartSeconds?: number; musicEndSeconds?: number; musicFadeInMs?: number; musicFadeOutMs?: number; loopCrossfadeMs?: number }) {
    const previous = this.musicSettings;
    this.musicSettings = { ...settings };
    if (!this.musicBuffer) return null;
    const buffer = this.musicBuffer;
    const fit = resolveMusicFit(settings, buffer.duration, buffer.sampleRate);
    const changed = fit.start !== this.musicTrim.start || fit.end !== this.musicTrim.end || fit.overlap !== resolveMusicFit(previous, buffer.duration, buffer.sampleRate).overlap;
    this.musicTrim = fit;
    if (changed) {
      this.fittedBuffer = null;
      if (fit.overlap > 0 && this.context) {
        // The fitted cycle can be far longer than the project. Materialize only
        // the audible prefix in that case, retaining its initial tail/head blend.
        const cycleFrames = Math.max(1, Math.round(fit.period * buffer.sampleRate));
        const projectFrames = Math.max(1, Math.ceil(this.duration * buffer.sampleRate));
        this.fittedLoop = cycleFrames <= projectFrames;
        const cycle = this.context.createBuffer(buffer.numberOfChannels, Math.min(cycleFrames, projectFrames), buffer.sampleRate);
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const input = buffer.getChannelData(channel), output = cycle.getChannelData(channel);
          for (let i = 0; i < output.length; i++) output[i] = fittedMusicSample(input, buffer.sampleRate, i / buffer.sampleRate, fit);
        }
        this.fittedBuffer = cycle;
      }
      if (this.playing && this.context) {
        try { this.musicSource?.stop(); } catch { /* already stopped */ }
        this.musicSource?.disconnect();
        this.startMusic(Math.max(this.context.currentTime, this.startedAt), this.currentTime);
      }
    }
    if (this.playing) this.reschedule();
    return peaksFor(this.fittedBuffer ?? buffer, this.duration, PEAK_BUCKETS, this.fittedBuffer ? this.fittedLoop : true, this.fittedBuffer ? 0 : fit.start, this.fittedBuffer ? this.fittedBuffer.duration : fit.end);
  }

  private startMusic(when: number, offset: number) {
    if (!this.context || !this.musicBuffer || !this.musicGain) return;
    const trim = this.musicTrim.length > 0 ? this.musicTrim : resolveMusicTrim({}, this.musicBuffer.duration);
    const music = this.context.createBufferSource();
    music.buffer = this.fittedBuffer ?? this.musicBuffer;
    music.loop = this.fittedBuffer ? this.fittedLoop : true;
    music.loopStart = this.fittedBuffer ? 0 : trim.start;
    music.loopEnd = this.fittedBuffer ? this.fittedBuffer.duration : trim.end;
    music.connect(this.musicGain);
    music.start(when, this.fittedBuffer ? (this.fittedLoop ? offset % this.fittedBuffer.duration : offset) : musicOffsetAt(offset, trim));
    this.musicSource = music;
  }

  private gainAt(time: number) {
    const base = dbToGain(this.baseDb) * musicFadeAt(time, this.duration, this.musicSettings);
    if (this.bypass) return base;
    return base * envelopeAt(this.envelope, this.envelopeRate, time);
  }

  private scheduleCurve(gain: AudioParam, offset: number, when: number, fromGain?: number) {
    const remaining = this.duration - offset;

    if (remaining <= 0.01) {
      gain.value = this.gainAt(offset);
      return;
    }

    const frames = Math.max(2, Math.ceil(remaining * this.envelopeRate) + 1);
    const curve = new Float32Array(frames);
    for (let index = 0; index < frames; index += 1) {
      const elapsed = index / (frames - 1) * remaining;
      const target = this.gainAt(offset + elapsed);
      const blend = Math.min(1, elapsed / 0.045);
      curve[index] = fromGain === undefined ? target : fromGain + (target - fromGain) * blend;
    }
    gain.setValueCurveAtTime(curve, when, remaining);
  }

  private replaceMusicGain(offset: number, when: number, smooth = false) {
    if (!this.context) return;
    const previous = this.musicGain;
    const next = this.context.createGain();
    next.gain.value = this.gainAt(offset);
    // Each AudioParam gets exactly one curve. Never insert events into, or
    // depend on browser cancellation of, an already-running value curve.
    this.scheduleCurve(next.gain, offset, when, smooth ? previous?.gain.value : undefined);
    next.connect(this.musicMonitor ?? this.limiter ?? this.context.destination);
    if (this.musicSource) {
      this.musicSource.disconnect();
      this.musicSource.connect(next);
    }
    previous?.disconnect();
    this.musicGain = next;
  }

  async play(from = this.pausedAt) {
    if (!this.loaded || !this.context || !this.musicBuffer || !this.voiceBuffer) {
      return;
    }

    const context = this.context;
    const token = ++this.playToken;
    await context.resume();
    if (token !== this.playToken) return;

    let offset = Math.max(0, Math.min(from, this.duration));
    if (offset >= this.duration - 0.02) offset = 0;

    this.stopSources();
    this.playing = true;
    this.pausedAt = offset;

    const when = context.currentTime + 0.07;
    this.startedAt = when;
    this.startOffset = offset;
    this.replaceMusicGain(offset, when);

    const voice = context.createBufferSource();
    voice.buffer = this.voiceBuffer;
    voice.connect(this.voiceGain!);
    if (offset < this.voiceBuffer.duration) {
      voice.start(when, offset);
    }
    this.voiceSource = voice;

    this.startMusic(when, offset);

  }

  pause() {
    if (!this.playing) return this.pausedAt;
    const time = this.currentTime;
    this.playToken += 1;
    this.stopSources();
    this.playing = false;
    this.pausedAt = time;
    return time;
  }

  seek(time: number) {
    const next = Math.max(0, Math.min(time, this.duration));
    if (this.playing) {
      void this.play(next);
    } else {
      this.pausedAt = next;
    }
  }

  private reschedule() {
    if (!this.context || !this.musicGain) return;
    const now = Math.max(this.context.currentTime, this.startedAt);
    const time = this.currentTime;
    this.replaceMusicGain(time, now, true);
  }

  private stopSources() {
    if (this.voiceSource) {
      try {
        this.voiceSource.stop();
      } catch {
        /* already stopped */
      }
      this.voiceSource.disconnect();
      this.voiceSource = null;
    }
    if (this.musicSource) {
      try {
        this.musicSource.stop();
      } catch {
        /* already stopped */
      }
      this.musicSource.disconnect();
      this.musicSource = null;
    }
  }

  destroy() {
    this.playToken += 1;
    this.stopSources();
    this.playing = false;
    this.voiceBuffer = null;
    this.musicBuffer = null;
    this.fittedBuffer = null;
    if (this.context) {
      void this.context.close().catch(() => {});
      this.context = null;
    }
  }
}
