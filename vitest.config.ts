import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: [
        'src/**/*.test.ts',
        '**/node_modules/**',
        '**/dist/**',
      ],
    },
    sequence: {
      concurrent: false,
    },
    testTimeout: 15_000,
  },
});
