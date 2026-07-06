import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@reley/core', '@reley/shared'] })],
    build: {
      outDir: 'out/main',
      lib: {
        entry: resolve('src/main/index.ts'),
        formats: ['cjs'],
      },
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          worker: resolve('src/worker/index.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
        external: [
          'electron',
          '@coral-xyz/anchor',
          '@solana/web3.js',
          '@solana/spl-token',
          'litesvm',
          'bs58',
          'bn.js',
          'borsh',
        ],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@reley/core', '@reley/shared'] })],
    build: {
      outDir: 'out/preload',
      lib: {
        entry: resolve('src/preload/index.ts'),
        formats: ['cjs'],
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
});
