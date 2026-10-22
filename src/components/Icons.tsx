import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.2 5.4 18 12l-9.8 6.6V5.4Z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.5 5.5v13M15.5 5.5v13" strokeWidth={2.2} />
    </Icon>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.8v10.4" />
      <path d="m7.8 10.2 4.2 4.3 4.2-4.3" />
      <path d="M4.5 16.4v2.2c0 .9.7 1.6 1.6 1.6h11.8c.9 0 1.6-.7 1.6-1.6v-2.2" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
    </Icon>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="10.2" width="14" height="9.3" rx="2.2" />
      <path d="M8.4 10.2V7.6a3.6 3.6 0 0 1 7.2 0v2.6" />
      <path d="M12 14.1v2" />
    </Icon>
  );
}

export function FilmIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.4" />
      <path d="M8 4.5v15M16 4.5v15M3.5 9h4.5M16 9h4.5M3.5 15h4.5M16 15h4.5" />
    </Icon>
  );
}

export function MusicIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.2 17.4V6.7l9-2v10.7" />
      <ellipse cx="6.7" cy="17.9" rx="2.5" ry="2.1" />
      <ellipse cx="15.7" cy="15.9" rx="2.5" ry="2.1" />
    </Icon>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.8 11.2a6.2 6.2 0 0 0 12.4 0M12 17.4v3.1M8.8 20.5h6.4" />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 12h15" />
      <path d="m13.8 6.2 5.8 5.8-5.8 5.8" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4.8 12.4 4.6 4.6L19.2 7" />
    </Icon>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.8 12.1c.1.9.8 1.6 1.7 1.6h6c.9 0 1.6-.7 1.7-1.6L17.5 7" />
      <path d="M10.2 10.6v6.2M13.8 10.6v6.2" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 9.5 6 6 6-6" />
    </Icon>
  );
}

export function SkipBackIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 5.5v13" />
      <path d="M18 6.8 10.2 12 18 17.2V6.8Z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function SkipForwardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M17.5 5.5v13" />
      <path d="M6 6.8 13.8 12 6 17.2V6.8Z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function ResetIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.8 9.4A7.6 7.6 0 1 1 4.5 14" />
      <path d="M4.8 4.8v4.6h4.6" />
    </Icon>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.6v5.1M12 16.2v.2" />
    </Icon>
  );
}

export function WaveIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 12h2.1l1.5-4.2 2.2 8.4 2-11 2.1 13.3 1.8-6.5h2.9l1.3-3 1.1 3h2" />
    </Icon>
  );
}

export function SlidersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 4.5v5.2M5 14.3v5.2M12 4.5v9.1M12 18.2v1.3M19 4.5v2.2M19 11.3v8.2" />
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="15.9" r="2" />
      <circle cx="19" cy="9" r="2" />
    </Icon>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.8 6.8c0-1 .8-1.8 1.8-1.8h3.7l2 2.2h8.1c1 0 1.8.8 1.8 1.8v8.2c0 1-.8 1.8-1.8 1.8H5.6c-1 0-1.8-.8-1.8-1.8V6.8Z" />
    </Icon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.3V12l3.1 1.9" />
    </Icon>
  );
}
