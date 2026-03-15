import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/test/**/*.test.ts'],
    // Run tests serially — better-sqlite3 in-memory DBs aren't thread-safe
    // (Vitest 4: singleFork → maxWorkers: 1 + isolate: false)
    pool: 'forks',
    maxWorkers: 1,
    isolate: false,
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts'],
      exclude: ['src/main/index.ts', 'src/main/preload.ts'],
    },
  },
  resolve: {
    alias: {
      // Stub out electron entirely so main-process modules load in Node
      electron: path.resolve(__dirname, 'src/test/__mocks__/electron.ts'),
    },
  },
});
