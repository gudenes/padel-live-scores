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
