import { defineConfig } from 'vitest/config';

// Deliberately separate from vite.config.js: that config applies the crx plugin,
// which builds a Chrome extension bundle and has no business running in tests.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
