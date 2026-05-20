// apps/ops/src/app/api/auth/[...nextauth]/route.ts
// Auth.js v5 handler — exposes Google/Resend/(Credentials) endpoints.

import { handlers } from '@/lib/auth'

export const { GET, POST } = handlers
