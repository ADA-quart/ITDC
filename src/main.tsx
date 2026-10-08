import React from 'react';
import ReactDOM from 'react-dom/client';
import './diag';
import './styles.css';
import App from './App';
import { I18nProvider } from './i18n';
import { ThemeProvider } from './contexts/ThemeContext';
import { Capacitor } from '@capacitor/core';

/**
 * 原生平台（APK）里清除 Service Worker 与缓存。
 *
 * 原因：APK 已经把前端资源打包在本地，PWA 的 Service Worker 在这里没有价值，
 * 反而会导致升级 APK 后 WebView 仍从缓存加载旧 JS ——
 * 表现为"装了新版本但功能没变"（小组件曾因此推送旧格式快照，课表列显示为空）。
 */
async function clearStaleServiceWorker(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // 清理失败不阻塞启动：页面仍可用，只是可能多走一次缓存
  }
}

void clearStaleServiceWorker().finally(() => {
  // 原生壳里整页禁止选中文字（点课程不该弹出选择手柄/复制菜单），
  // 输入框例外，由 styles.css 里 body.itdc-native 的规则放行
  if (Capacitor.isNativePlatform()) document.body.classList.add('itdc-native');
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeProvider>
        <I18nProvider>
          <App />
        </I18nProvider>
      </ThemeProvider>
    </React.StrictMode>
  );
});
