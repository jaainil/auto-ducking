import { useId } from "react";
import { MASTERING_PRESETS, getMasteringPreset } from "../../shared/mastering.js";
import type { MasteringOptions, MasteringPresetId, MasteringReport } from "../types";

function measurement(value: number | null, unit: string) {
  return value === null ? "Unmeasurable" : `${value.toFixed(1).replace("-", "−")} ${unit}`;
}

export function LoudnessMastering({ value, onChange, disabled }: {
  value: MasteringOptions;
  onChange: (value: MasteringOptions) => void;
  disabled: boolean;
}) {
  const id = useId();
  const preset = getMasteringPreset(value.preset);
  return (
    <div className="mastering-controls">
      <label className="checkbox-row mastering-toggle">
        <input type="checkbox" checked={value.enabled} disabled={disabled}
          onChange={event => onChange({ ...value, enabled: event.target.checked })}
          aria-describedby={`${id}-scope`} />
        <span>Smart Loudness Mastering
          <span className="checkbox-hint">Balance loudness, dynamics and peaks.</span>
        </span>
      </label>
      {value.enabled && (
        <div className="mastering-settings">
          <label htmlFor={`${id}-preset`}>Mastering preset</label>
          <select id={`${id}-preset`} value={value.preset} disabled={disabled}
            aria-describedby={`${id}-description ${id}-recommendation`}
            onChange={event => onChange({ ...value, preset: event.target.value as MasteringPresetId })}>
            {MASTERING_PRESETS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <p id={`${id}-description`} className="mastering-description">{preset.description}</p>
          <dl className="mastering-targets" aria-label="Recommended mastering targets">
            <div><dt>Loudness</dt><dd>{measurement(preset.integratedLufs, "LUFS")}</dd></div>
            <div><dt>Peak ceiling</dt><dd>{measurement(preset.truePeakDbtp, "dBTP")}</dd></div>
            <div><dt>Range up to</dt><dd>{preset.loudnessRangeLu} LU</dd></div>
          </dl>
          <p id={`${id}-recommendation`} className="mastering-note">Recommended starting points, not official platform targets.{value.preset === "advertisements" ? " Check your ad delivery brief." : ""}</p>
        </div>
      )}
      <p id={`${id}-scope`} className="mastering-note">{value.enabled
        ? "Applied to exports only. Preview plays your ducked mix."
        : "Mastering is off. Export keeps your mix levels with peak protection."}</p>
    </div>
  );
}

export function LoudnessReport({ report }: { report: MasteringReport }) {
  const rows = [
    { name: "Loudness", key: "integratedLufs" as const, unit: "LUFS" },
    { name: "True peak", key: "truePeakDbtp" as const, unit: "dBTP" },
    { name: "Range", key: "loudnessRangeLu" as const, unit: "LU" },
  ];
  return (
    <section className="mastering-report" aria-label="Mastering report">
      <div className="mastering-report-head">
        <h3>Mastering report</h3>
        <span className={`mastering-verdict${report.status === "review" ? " needs-review" : ""}`}>
          {report.status === "passed" ? "Checks passed" : "Review suggested"}
        </span>
      </div>
      <p className="mastering-note">{report.presetName} · Measured from the exported file.</p>
      <table className="mastering-measurements">
        <caption className="sr-only">Mix and exported audio measurements</caption>
        <thead><tr><th scope="col">Measure</th><th scope="col">Mix</th><th scope="col">Export</th></tr></thead>
        <tbody>{rows.map(row => (
          <tr key={row.key}><th scope="row">{row.name}</th>
            <td>{measurement(report.before[row.key], row.unit)}</td>
            <td>{measurement(report.after[row.key], row.unit)}</td>
          </tr>
        ))}</tbody>
      </table>
      {report.status === "review" && <p className="mastering-review-note">Some measurements need a listen or a different preset. Your file is still available to download.</p>}
      <details className="mastering-checks">
        <summary>Quality checks</summary>
        <ul>{report.checks.map(check => <li key={check.id}>
          <div><strong>{check.label}</strong><span>{check.status === "passed" ? "Pass" : "Review"}</span></div>
          <p>{check.detail}</p>
        </li>)}</ul>
      </details>
    </section>
  );
}
