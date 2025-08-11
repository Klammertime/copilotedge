// vitest.config.mjs - ESM version of the config
import { defineConfig } from 'vitest/config';

// Note: We'll handle crypto setup in test files instead
// The global crypto property is read-only in some environments

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'test/**',
        '*.config.ts',
        '*.config.mjs'
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80
      }
    },
    testTimeout: 30000,
    mockReset: true,
    restoreMocks: true
  }
});
