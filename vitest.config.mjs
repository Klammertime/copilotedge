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
        'examples/**',
        'benchmarks/**',
        '*.config.ts',
        '*.config.mjs',
        '**/*.d.ts',
        'index.js'
      ],
      thresholds: {
        branches: 65,
        functions: 60,
        lines: 45,
        statements: 45
      }
    },
    testTimeout: 30000,
    mockReset: true,
    restoreMocks: true
  }
});
