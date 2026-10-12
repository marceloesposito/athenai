import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // logos si usa dai sorgenti TypeScript: va compilato anche da node_modules
    server: { deps: { inline: ['logos'] } },
  },
});
