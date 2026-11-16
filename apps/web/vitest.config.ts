import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'web',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 300_000,
  },
})
