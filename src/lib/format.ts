export function formatTimecode(seconds: number, tenths = false) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const whole = Math.floor(safe % 60);
  if (!tenths) {
    return `${minutes}:${String(whole).padStart(2, "0")}`;
  }
  const fraction = Math.floor((safe % 1) * 10);
  return `${minutes}:${String(whole).padStart(2, "0")}.${fraction}`;
}

export function formatDuration(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (safe < 10) return `${safe.toFixed(1)}s`;
  if (safe < 60) return `${Math.round(safe)}s`;
  return formatTimecode(safe);
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDb(value: number, sign = false) {
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  const prefix = sign || value > 0 ? "+" : "−";
  return `${prefix}${rounded} dB`;
}

export function formatRegion(start: number, end: number) {
  return `${formatTimecode(start, true)} – ${formatTimecode(end, true)}`;
}

export function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return `Today, ${new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date)}`;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function deriveProjectName(filename: string) {
  const base = filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return "Untitled Reel";
  return base
    .split(" ")
    .slice(0, 8)
    .map((word) =>
      word.length > 2 ? word[0].toUpperCase() + word.slice(1) : word,
    )
    .join(" ");
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
