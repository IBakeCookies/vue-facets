import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// `vite build` bundles the library, `vite build --mode demo` bundles the example app
export default defineConfig(({ command, mode }) => ({
    plugins: [vue()],
    // the demo's static assets have no business in the published package
    publicDir: command === 'build' && mode !== 'demo' ? false : 'public',
    build:
        mode === 'demo'
            ? { outDir: 'dist-demo' }
            : {
                  lib: {
                      entry: 'src/index.ts',
                      formats: ['es', 'cjs'],
                      fileName: (format: string) => (format === 'es' ? 'index.js' : 'index.cjs'),
                  },
                  rollupOptions: {
                      external: ['vue'],
                  },
              },
    test: {
        environment: 'jsdom',
        // `npm test` filters this down to src, `npm run bench` to bench
        include: ['src/**/*.spec.ts', 'bench/**/*.bench.ts'],
    },
}));
