import { useId } from "react";

export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="AudioDuck Studio"
    >
      <rect width="32" height="32" rx="8" fill="#2563EB" />
      <path
        d="M7 12.5h6.2c2.2 0 3.1 1.1 4.1 3.5s2.1 3.5 4.3 3.5H25"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="24.9" cy="10.2" r="1.9" fill="#fff" />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <BrandMark />
      <span className="brand-name">
        AudioDuck{!compact && <span className="brand-suffix"> Studio</span>}
      </span>
    </span>
  );
}

export function DotSphere({
  className,
  size = 520,
  dot = 1.15,
}: {
  className?: string;
  size?: number;
  dot?: number;
}) {
  const id = useId();
  const points: Array<{ x: number; y: number; opacity: number }> = [];

  for (let lat = -78; lat <= 78; lat += 7.2) {
    const latitude = (lat * Math.PI) / 180;
    const ring = Math.cos(latitude);
    const count = Math.max(5, Math.round(ring * 34));
    for (let index = 0; index < count; index += 1) {
      const longitude = (index / count) * Math.PI * 2;
      const x = 50 + 46 * ring * Math.cos(longitude);
      const y = 50 + 46 * Math.sin(latitude);
      const depth = Math.max(0, ring * Math.cos(longitude));
      points.push({ x, y, opacity: 0.18 + depth * 0.72 });
    }
  }

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={`${id}-fade`} cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor="#fff" stopOpacity="1" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={`${id}-mask`}>
          <circle cx="50" cy="50" r="48" fill={`url(#${id}-fade)`} />
        </mask>
      </defs>
      <g mask={`url(#${id}-mask)`} fill="currentColor">
        {points.map((point, index) => (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={dot}
            opacity={point.opacity}
          />
        ))}
      </g>
    </svg>
  );
}
