// src/app/ops/layout.tsx
// Independent light-theme layout for the ops dashboard.
// No bottom nav, no PadelNacho app shell.
// The OpsClient component itself uses a fixed overlay to escape the root layout's dark wrapper.

export const metadata = {
  title: 'PadelNacho Ops',
}

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
