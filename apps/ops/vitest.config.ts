import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    server: {
      deps: {
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
