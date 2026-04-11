import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const PORT = 3000;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    open: true,
    proxy: { '/api': { target: 'http://localhost:' + PORT, changeOrigin: true } },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-calendar': ['@fullcalendar/core', '@fullcalendar/react', '@fullcalendar/daygrid', '@fullcalendar/timegrid', '@fullcalendar/interaction', '@fullcalendar/rrule'],
          'vendor-antd': ['antd', '@ant-design/icons'],
        },
      },
    },
    chunkSizeWarningLimit: 1300,
  },
});
