// src/app/ops/layout.tsx
// Independent light-theme layout for the ops dashboard.
// No bottom nav, no Padel Nachos app shell.
// The OpsClient component itself uses a fixed overlay to escape the root layout's dark wrapper.

export const metadata = {
  title: 'Padel Nachos Ops',
}

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  // The `ops-route` class is a marker the desktop phone-frame CSS uses to
  // deactivate itself for ops pages. Ops needs the full viewport for tables,
  // multi-column dashboards, and the >1100px-only data tools — squeezing it
  // into a 412px phone screen makes most of the UI inaccessible. See the
  // .app-canvas:has(.ops-route) rules in src/app/globals.css.
  return <div className="ops-route">{children}</div>
}
