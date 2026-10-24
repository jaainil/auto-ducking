export function analysisFilter(preset) {
  return `loudnorm=I=${preset.integratedLufs}:TP=${preset.truePeakDbtp}:LRA=${preset.loudnessRangeLu}:print_format=json`;
}

export function parseLoudness(stderr) {
  const blocks = String(stderr).match(/\{[^{}]*\}/g) ?? [];
  const candidates = blocks.filter((block) => /"input_i"\s*:/.test(block));
  if (!candidates.length) throw new Error('FFmpeg did not return loudness measurements.');
  let data;
  try { data = JSON.parse(candidates.at(-1)); } catch { throw new Error('Malformed loudness measurements.'); }
  const number = (key, allowInfinity = false) => {
    const raw = data[key];
    if ((typeof raw !== 'string' && typeof raw !== 'number') || String(raw).trim() === '') throw new Error(`Missing loudness measurement: ${key}.`);
    if (allowInfinity && /^[-+]?inf(?:inity)?$/i.test(String(raw))) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`Invalid loudness measurement: ${key}.`);
    return value;
  };
  return {
    integratedLufs: number('input_i', true),
    truePeakDbtp: number('input_tp', true),
    loudnessRangeLu: number('input_lra'),
    thresholdLufs: number('input_thresh'),
    offsetDb: number('target_offset', true),
  };
}

export function masteringFilter(preset, measurement, peakCeiling = preset.truePeakDbtp - 0.5) {
  if (!Number.isFinite(measurement.integratedLufs) || !Number.isFinite(measurement.truePeakDbtp)) return 'anull';
  // FFmpeg automatically falls back to dynamic normalization when a linear
  // gain would exceed the peak ceiling or cannot meet the requested range.
  return `loudnorm=I=${preset.integratedLufs}:TP=${peakCeiling}:LRA=${preset.loudnessRangeLu}:measured_I=${measurement.integratedLufs}:measured_TP=${measurement.truePeakDbtp}:measured_LRA=${measurement.loudnessRangeLu}:measured_thresh=${measurement.thresholdLufs}:offset=${measurement.offsetDb ?? 0}:linear=true:print_format=json`;
}

export function qualityReport(preset, before, after) {
  const check = (id, label, value, passes, detail) => ({
    id, label, status: Number.isFinite(value) && passes ? 'passed' : 'review',
    detail: Number.isFinite(value) ? detail : 'Not enough measurable audio to verify this target.',
  });
  const checks = [
    check('loudness', 'Integrated loudness', after.integratedLufs, Math.abs(after.integratedLufs - preset.integratedLufs) <= 1, `${after.integratedLufs} LUFS; target ${preset.integratedLufs} LUFS (±1 LU).`),
    check('truePeak', 'True peak', after.truePeakDbtp, after.truePeakDbtp <= preset.truePeakDbtp + 0.1, `${after.truePeakDbtp} dBTP; ceiling ${preset.truePeakDbtp} dBTP (0.1 dB tolerance).`),
    check('range', 'Loudness range', after.loudnessRangeLu, after.loudnessRangeLu <= preset.loudnessRangeLu + 1, `${after.loudnessRangeLu} LU; suggested maximum ${preset.loudnessRangeLu} LU (1 LU tolerance).`),
  ];
  return { preset: preset.id, presetName: preset.name, targets: { integratedLufs: preset.integratedLufs, truePeakDbtp: preset.truePeakDbtp, loudnessRangeLu: preset.loudnessRangeLu }, before, after, status: checks.every((entry) => entry.status === 'passed') ? 'passed' : 'review', checks };
}
