// 原生（APK）构建的 Service Worker 清理。
//
// 背景：APK 升级后 WebView 会从 Service Worker 缓存加载旧 JS ——
// 明明装了新版本，功能却没变（实测：新 APK 内是 index-Pvf4VNkg.js，
// WebView 仍加载旧的 index-C6uGv81L.js）。
//
// 方案：把 dist 里的 sw.js 换成一个"自杀式"脚本 ——
// 它一被激活就清空所有缓存、注销自己，之后 WebView 直接从本地资源加载。
// sw.js 自身不会被 SW 拦截，所以旧版本一定能拿到这个新脚本。
//
// 在 capacitor sync 之前运行，覆盖 VitePWA 生成的产物。
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.cwd(), 'dist');

const killSwitchSw = `// ITDC native build: kill-switch service worker.
// 清空缓存并注销自己，确保 APK 升级后加载最新的打包资源。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      // 不主动 reload：避免在注入/跳转过程中打断页面；下次启动即为新资源
      void clients;
    } catch (e) { /* 忽略：清理尽力而为 */ }
  })());
});
// 不实现 fetch 拦截 —— 所有请求直接走本地资源
`;

const unregisterScript = `// ITDC native build: 不注册 Service Worker，并清掉历史注册与缓存。
// 原生包已把资源打包在本地，SW 只会导致升级后读到旧代码。
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((rs) => Promise.all(rs.map((r) => r.unregister())))
    .catch(() => {});
}
if (typeof caches !== 'undefined') {
  caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).catch(() => {});
}
`;

function write(rel, body) {
  const target = path.join(dist, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, 'utf8');
  return rel;
}

if (!fs.existsSync(dist)) {
  console.error('[native-sw] dist 不存在，请先运行 vite build');
  process.exit(1);
}

const written = [write('sw.js', killSwitchSw), write('registerSW.js', unregisterScript)];

// 清掉 workbox 运行时（已无 SW 引用它，留着只会增加包体）
for (const f of fs.readdirSync(dist)) {
  if (/^workbox-.*\.js$/.test(f)) {
    fs.unlinkSync(path.join(dist, f));
    written.push(f + ' (removed)');
  }
}

console.log('[native-sw] 已替换:' + written.join(', '));