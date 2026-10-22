import { dbToGain, envelopeAt } from "../../shared/envelope.js";
import type { Peaks } from "../types";

const PEAK_BUCKETS = 2200;

function peaksFor(
  buffer: AudioBuffer,
  duration: number,
  buckets: number,
  loop: boolean,
): Peaks["voice"] {
  const channel = buffer.getChannelData(0);
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  const secondsPerBucket = duration / buckets;
  const samplesPerBucket = secondsPerBucket * buffer.sampleRate;
  const stride = Math.max(1, Math.floor(samplesPerBucket / 140));

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = Math.floor(bucket * samplesPerBucket);
    const end = Math.min(
      channel.length,
      Math.ceil((bucket + 1) * samplesPerBucket),
    );
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
        const value = channel[(start + offset) % channel.length] ?? 0;
        if (value < low) low = value;
        if (value > high) high = value;
      }
    } else {
      for (let index = start; index < end; index += stride) {
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
}

export class PreviewAudio {
  private context: AudioContext | null = null;
  private voiceBuffer: AudioBuffer | null = null;
  private musicBuffer: AudioBuffer | null = null;
  private voiceSource: AudioBufferSourceNode | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  private voiceGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;

  private envelope: Float32Array = new Float32Array([1]);
  private envelopeRate = 200;
  private baseDb = -12;
  private bypass = false;
  private duration = 0;

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
      Math.max(0, this.startOffset + (this.context.currentTime - this.startedAt)),
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
      this.musicGain.connect(this.limiter);
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

    return {
      voiceDuration: voiceBuffer.duration,
      musicDuration: musicBuffer.duration,
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
    else if (this.musicGain) {
      this.musicGain.gain.value = this.gainAt(this.pausedAt);
    }
  }

  private gainAt(time: number) {
    const base = dbToGain(this.baseDb);
    if (this.bypass) return base;
    return base * envelopeAt(this.envelope, this.envelopeRate, time);
  }

  private scheduleCurve(offset: number, when: number) {
    if (!this.musicGain) return;
    const gain = this.musicGain.gain;
    const remaining = this.duration - offset;

    if (remaining <= 0.01) {
      gain.setValueAtTime(this.gainAt(offset), when);
      return;
    }

    const frames = Math.max(2, Math.ceil(remaining * this.envelopeRate));
    const curve = new Float32Array(frames);
    for (let index = 0; index < frames; index += 1) {
      curve[index] = this.gainAt(offset + index / this.envelopeRate);
    }
    gain.setValueCurveAtTime(curve, when, remaining);
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

    const voice = context.createBufferSource();
    voice.buffer = this.voiceBuffer;
    voice.connect(this.voiceGain!);
    if (offset < this.voiceBuffer.duration) {
      voice.start(when, offset);
    }
    this.voiceSource = voice;

    const music = context.createBufferSource();
    music.buffer = this.musicBuffer;
    music.loop = true;
    music.connect(this.musicGain!);
    music.start(when, offset % this.musicBuffer.duration);
    this.musicSource = music;

    const gain = this.musicGain!.gain;
    gain.cancelScheduledValues(0);
    gain.setValueAtTime(this.gainAt(offset), when);
    this.scheduleCurve(offset, when);
  }

  pause() {
    if (!this.playing) return this.pausedAt;
    const time = this.currentTime;
    this.playToken += 1;
    this.stopSources();
    this.playing = false;
    this.pausedAt = time;
    if (this.musicGain) {
      this.musicGain.gain.cancelScheduledValues(0);
      this.musicGain.gain.value = this.gainAt(time);
    }
    return time;
  }

  seek(time: number) {
    const next = Math.max(0, Math.min(time, this.duration));
    if (this.playing) {
      void this.play(next);
    } else {
      this.pausedAt = next;
      if (this.musicGain) {
        this.musicGain.gain.cancelScheduledValues(0);
        this.musicGain.gain.value = this.gainAt(next);
      }
    }
  }

  private reschedule() {
    if (!this.context || !this.musicGain) return;
    const now = this.context.currentTime;
    const time = this.currentTime;
    const target = this.gainAt(time);
    const gain = this.musicGain.gain;

    // Capture before cancellation: removing automation can reset gain.value.
    const heldGain = gain.value;
    // Some browsers retain a curve that began before `now`. Remove its
    // start event too before placing any new events inside its time span.
    gain.cancelScheduledValues(0);
    gain.setValueAtTime(heldGain, now);
    gain.linearRampToValueAtTime(target, now + 0.045);
    this.scheduleCurve(time + 0.045, now + 0.045);
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
    if (this.context) {
      void this.context.close().catch(() => {});
      this.context = null;
    }
  }
}
