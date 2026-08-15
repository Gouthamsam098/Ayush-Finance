import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    // Pin the support floor explicitly instead of relying on Vite's default.
    // Safari 14 is the practical minimum for older iPads/iPhones still in field
    // use; without this the floor is implicit and can drift upward silently
    // when a dependency ships newer syntax.
    target: ['es2020', 'safari14'],
    // Never emit source maps in production — they would publish readable
    // application source (including business logic) to anyone who looks.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keep the rarely-changing framework code in its own chunk so it stays
        // cached across deploys instead of being invalidated by app changes.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          redux: ['@reduxjs/toolkit', 'react-redux'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: process.env.VITE_API_URL || 'http://localhost:4000', changeOrigin: true },
    },
  },
});
