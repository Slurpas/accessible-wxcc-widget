import { defineConfig } from 'vite';

/**
 * Production: one self-contained IIFE file, dist/accessible-wxcc-widget.js,
 * which Desktop loads through the layout "script" URL.
 * Mock mode is compiled out of production builds (__AWX_MOCK_ALLOWED__ = false).
 * Dev server (npm run dev): serves dev/index.html with mock mode enabled.
 */
export default defineConfig(({ command }) => {
  const devServer = command === 'serve' && !process.env.VITEST;
  return {
  root: devServer ? 'dev' : '.',
  define: {
    // Tests import the mock directly, so they keep mock mode compiled out like production.
    __AWX_MOCK_ALLOWED__: JSON.stringify(devServer),
  },
  server: {
    port: 5199,
    strictPort: true,
    host: '127.0.0.1',
    fs: { allow: ['..'] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    minify: true,
    lib: {
      entry: 'src/index.js',
      formats: ['iife'],
      name: 'AccessibleWxccWidget',
      fileName: () => 'accessible-wxcc-widget.js',
    },
  },
  test: {
    root: '.',
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    globals: false,
  },
  };
});
