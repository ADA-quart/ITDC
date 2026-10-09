import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';
import { VitePWA } from 'vite-plugin-pwa';

const BACKEND_PORT = process.env.BACKEND_PORT || process.env.PORT || 3000;

// 前端展示的版本号取自 package.json，避免多处各写一份导致不一致。
// 修改版本时请同步 capacitor.config.json 与 android/app/build.gradle 的 versionName。
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      // onnxruntime-web 默认入口自带 webgpu/wasm 二进制（28MB），直接进包太亏。
      // 这里指向 "extern wasm" 变体：包里只有 JS 胶水，13.6MB 的 wasm 与两个
      // ONNX 模型都由 App 内的「离线 OCR 扩展」按需下载（src/api/ocr/installer.ts）。
      'onnxruntime-web/wasm': path.resolve(
        __dirname,
        'node_modules/onnxruntime-web/dist/ort.wasm.min.mjs',
      ),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // onnxruntime 的 wasm（14MB）与模型一样属于按需资源，不进 SW 预缓存
        globIgnores: ['**/ort-wasm-*.wasm'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        name: '智能待办课表——日日新',
        short_name: '日日新',
        description: '智能待办 + 课表：艾森豪威尔四象限、AI 拆解排程、离线 OCR 图片转待办（Day Day New）',
        start_url: '/',
        display: 'standalone',
        theme_color: '#1890ff',
        background_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    open: process.env.VITE_OPEN !== 'false',
    proxy: { '/api': { target: 'http://localhost:' + BACKEND_PORT, changeOrigin: true } },
  },
  base: "./",
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
