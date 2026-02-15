import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: ['**/targets/**', '**/node_modules/**'],
    },
    host: '0.0.0.0',
    allowedHosts: true,
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
