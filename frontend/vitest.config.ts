import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'apps/public/src'),
      '@admin': path.resolve(__dirname, 'apps/admin/src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}', 'apps/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['apps/{public,admin}/src/**/*.{ts,tsx}', 'shared/**/*.{ts,tsx}'],
      exclude: ['**/vite-env.d.ts'],
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage',
    },
  },
});
