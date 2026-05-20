// apps/ops/src/types/auth.d.ts
// Augment Auth.js `Session` to include the operator flag we enrich in lib/auth.ts.

import 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email?: string | null
      name?: string | null
      image?: string | null
      isOperator?: boolean
    }
  }
}
