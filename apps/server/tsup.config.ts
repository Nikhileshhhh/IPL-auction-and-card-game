import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  // Workspace packages ship TypeScript source; bundle them. Third-party
  // dependencies stay external and resolve from node_modules at runtime.
  noExternal: [/^@stumps\//],
});
