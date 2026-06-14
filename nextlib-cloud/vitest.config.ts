import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    // Default: Node environment. Most suites are server-side (crypto, DB
    // routes, middleware, AI/WhatsApp libs) and need Node built-ins which jsdom
    // does not provide.
    //
    // React component tests (`.tsx`) opt into jsdom via a per-file docblock:
    //   // @vitest-environment jsdom
    // This matches the established convention in download/plugin/route.test.ts.
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 30000,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/test/**',
        'src/**/*.d.ts',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
