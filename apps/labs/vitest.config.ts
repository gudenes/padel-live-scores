import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    server: {
      deps: {
        // next-auth is pure ESM and imports 'next/server' without .js extension,
        // which fails under Node's strict ESM resolution. Inlining forces Vitest's
        // bundler to handle it (which tolerates extensionless specifiers).
        inline: ['next-auth', '@auth/core', '@auth/pg-adapter'],
      },
    },
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
})
