/** Rust ABI settings order is documented in native/adaptive/src/lib.rs.
 * Each engine owns its WASM memory. buildEnvelope is synchronous and has no
 * awaits, so calls in a worker or Node event loop cannot interleave allocations.
 */
export async function createAdaptiveEngine(bytes) {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const { memory, alloc_f64: allocate, dealloc_f64: free, generate_envelope: generate } = instance.exports;
  if (!(memory instanceof WebAssembly.Memory) || !allocate || !free || !generate) throw new Error('Invalid adaptive WASM module');
  const settingKeys = ['adaptiveTargetGapDb', 'adaptiveMinReductionDb', 'adaptiveMaxReductionDb', 'baseMusicDb', 'adaptiveHysteresisDb', 'adaptiveMaxChangeDbPerSecond', 'lookAheadMs', 'holdMs', 'fadeDownMs', 'releaseMs', 'musicFadeInMs', 'musicFadeOutMs'];
  const numeric = value => value === undefined ? NaN : Number(value);
  return {
    buildEnvelope(segments, settings = {}, duration, rate = 200, levels) {
      if (!Number.isFinite(duration) || duration <= 0 || duration > 600) throw new Error('Project duration must be positive and at most 600 seconds');
      if (!Number.isFinite(rate) || rate < 1 || rate > 1000) throw new Error('Envelope rate must be between 1 and 1000');
      const count = Math.ceil(duration * 50);
      const validArray = value => Array.isArray(value) || value instanceof Float32Array || value instanceof Float64Array;
      if (!levels || levels.hopMs !== 20 || !validArray(levels.voiceRms) || !validArray(levels.musicRms) || levels.voiceRms.length !== count || levels.musicRms.length !== count) throw new Error('Adaptive RMS profile requires aligned 20 ms voice and music arrays matching project duration');
      settings = settings || {};
      const regions = [];
      for (const region of Array.isArray(segments) ? segments : []) {
        if (!region || region.enabled === false || !Number.isFinite(region.start) || !Number.isFinite(region.end) || region.end <= region.start) continue;
        const override = region.reductionDb != null && Number.isFinite(Number(region.reductionDb)) ? Math.max(0, Number(region.reductionDb)) : -1;
        regions.push(region.start, region.end, 1, override);
      }
      if (regions.length > 600000) throw new Error('Too many adaptive speech regions');
      const configuration = [duration, rate, 20, ...settingKeys.map(key => numeric(settings[key]))];
      const outputCount = Math.ceil(duration * rate);
      const allocations = [];
      const alloc = count => {
        const pointer = allocate(count);
        if (!pointer) throw new Error('Adaptive WASM allocation failed');
        allocations.push([pointer, count]);
        return pointer;
      };
      try {
        // Allocate first, then create views: any allocation can grow memory.
        const voice = alloc(count), music = alloc(count);
        const segmentPointer = regions.length ? alloc(regions.length) : 0;
        const config = alloc(configuration.length), output = alloc(outputCount);
        new Float64Array(memory.buffer, voice, count).set(levels.voiceRms);
        new Float64Array(memory.buffer, music, count).set(levels.musicRms);
        if (regions.length) new Float64Array(memory.buffer, segmentPointer, regions.length).set(regions);
        new Float64Array(memory.buffer, config, configuration.length).set(configuration);
        const status = generate(voice, music, count, segmentPointer, regions.length / 4, config, output, outputCount);
        if (status !== 0) throw new Error(`Adaptive WASM rejected input (status ${status})`);
        // Rust scratch allocations can also grow memory; recreate the view.
        return Float32Array.from(new Float64Array(memory.buffer, output, outputCount));
      } finally {
        for (const [pointer, count] of allocations.reverse()) free(pointer, count);
      }
    },
  };
}
