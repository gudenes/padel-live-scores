import type { SVGProps } from "react";
type Props = SVGProps<SVGSVGElement> & { size?: number };
function Icon({ size = 18, children, ...props }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}
export const Clock = (props: Props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 6v6l4 2" />
  </Icon>
);
export const ArrowLeft = (props: Props) => (
  <Icon {...props}>
    <path d="M19 12H5m6-6-6 6 6 6" />
  </Icon>
);
export const ArrowRight = (props: Props) => (
  <Icon {...props}>
    <path d="M5 12h14m-6-6 6 6-6 6" />
  </Icon>
);
export const CaretDown = (props: Props) => (
  <Icon {...props}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
export const DownloadSimple = (props: Props) => (
  <Icon {...props}>
    <path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5" />
  </Icon>
);
export const CheckCircle = (props: Props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 3 3 5-6" />
  </Icon>
);
export const Info = (props: Props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6m0-10v.1" />
  </Icon>
);
export const OverlayOff = (props: Props) => <Icon {...props}><path d="M3 3l18 18M10 5a11 11 0 0 1 11 7 15 15 0 0 1-3 4M6 6a15 15 0 0 0-3 6c3 6 9 9 15 6"/></Icon>;
export const TeamShape = (props: Props) => <Icon {...props}><circle cx="5" cy="7" r="3"/><circle cx="19" cy="17" r="3"/><path d="m8 9 8 6M3 18h6M6 15v6"/></Icon>;
export const MovementTrail = (props: Props) => <Icon {...props}><path d="M3 19h5a4 4 0 0 0 0-8H7a4 4 0 0 1 0-8h13m-4 4 4-4-4-1"/></Icon>;
export const PlayerGroup = (props: Props) => <Icon {...props}><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v2"/></Icon>;
export const OverlaySettings = (props: Props) => <Icon {...props}><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="18" r="2" fill="currentColor"/></Icon>;
export const CourtFlat = (props: Props) => <Icon {...props}><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M12 4v16M6 4v16M18 4v16M6 12h12"/></Icon>;
export const CourtCube = (props: Props) => <Icon {...props}><path d="m12 2 9 5v10l-9 5-9-5V7Zm0 10 9-5m-9 5L3 7m9 5v10"/></Icon>;

export const NetDistance = (props: Props) => <Icon {...props}><path d="M3 4h18M5 4v4m4-4v4m6-4v4m4-4v4M12 10v10m-3-7 3-3 3 3m-6 4 3 3 3-3"/></Icon>;
export const PairConnection = (props: Props) => <Icon {...props}><circle cx="4" cy="12" r="2"/><circle cx="20" cy="12" r="2"/><path d="M8 12h2m4 0h2M4 5v3m16-3v3M4 16v3m16-3v3"/></Icon>;

export const CourtZones = (props: Props) => <Icon {...props}><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M4 7h16M4 10h16M4 14h16M4 17h16M2 12h20"/></Icon>;
export const PressureGauge = (props: Props) => <Icon {...props}><path d="M4 19a10 10 0 1 1 16 0M12 3v3M4 8l3 2m13-2-3 2m-5 5 5-5"/><circle cx="12" cy="15" r="2"/><path d="M8 21h8"/></Icon>;
