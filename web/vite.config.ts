import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // libsodium e' gia' un modulo pronto: niente pre-bundling (wasm incluso nel file)
  optimizeDeps: { exclude: ['libsodium-wrappers-sumo'] },
  build: { target: 'es2022', sourcemap: true },
});
