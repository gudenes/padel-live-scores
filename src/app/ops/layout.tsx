// src/app/ops/layout.tsx
// Independent light-theme layout for the ops dashboard.
// No bottom nav, no PadelNacho app shell.

export const metadata = {
  title: 'PadelNacho Ops',
}

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0,
        padding: 0,
        background: '#f8f9fa',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#1a1a1a',
        minHeight: '100vh',
      }}>
        {children}
      </body>
    </html>
  )
}
