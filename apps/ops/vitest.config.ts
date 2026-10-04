import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts', 'src/**/__tests__/**/*.test.ts', 'src/**/_lib/*.test.ts'],
    server: {
      deps: {
        inline: ['next-auth', '@auth/core', '@auth/pg-adapter'],
      },
    },
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      // Testing Library lives at the repository root; share its React instance.
      'react': new URL('../../node_modules/react', import.meta.url).pathname,
      'react-dom': new URL('../../node_modules/react-dom', import.meta.url).pathname,
    },
  },
})
