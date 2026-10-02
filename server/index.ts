import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import calendarRouter from './routes/calendar.js';
import todoRouter from './routes/todo.js';
import scheduleRouter from './routes/schedule.js';
import widgetRouter from './routes/widget.js';
import settingsRouter from './routes/settings.js';
import syncRouter from './routes/sync.js';
import schoolRouter from './routes/school.js';
import db, { ready } from './db/index.js';

if (process.platform === 'win32') { try { execSync('chcp 65001', { stdio: 'pipe' }); } catch {} }

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const app = express();

// 反向代理（Railway / Render / Fly / Nginx）之后运行：取真实协议与客户端 IP
app.set('trust proxy', true);

// CORS：默认放行本机与局域网（开发 + 家用路由），云端前端来源用 CORS_ORIGINS 显式声明。
// 例：CORS_ORIGINS=https://itdc.example.com,https://itdc.pages.dev
// 纯自建/内网部署可设 CORS_ALLOW_ALL=1 直接放行任意来源。
const LOCAL_HOSTNAME = /^(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/;
const EXTRA_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const CORS_ALLOW_ALL = process.env.CORS_ALLOW_ALL === '1';

app.use(cors({
  origin: (origin, callback) => {
    // 无 origin：curl、服务端调用、原生 App 的直连请求
    if (!origin) return callback(null, true);
    if (CORS_ALLOW_ALL) return callback(null, true);
    try {
      const url = new URL(origin);
      // 局域网 / 本机 / Capacitor WebView（https://localhost、capacitor://localhost）
      if (LOCAL_HOSTNAME.test(url.hostname)) return callback(null, true);
    } catch { /* 非法 origin 走下面的白名单判断 */ }
    if (EXTRA_ORIGINS.includes(origin.replace(/\/+$/, ''))) return callback(null, true);
    callback(null, false);
  },
  credentials: true,
}));
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({
  status: 'ok',
  version: '1.1.0',
  serverTime: new Date().toISOString(),
}));

app.use('/api/calendar', calendarRouter);
app.use('/api/todos', todoRouter);
app.use('/api/schedule', scheduleRouter);
app.use('/api/widget', widgetRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/sync', syncRouter);
app.use('/api/school', schoolRouter);

// 未匹配的 /api/* 统一返回 JSON 404，避免落入 SPA fallback 返回 index.html
app.use('/api', (_req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 生产环境：静态文件服务 & SPA fallback（必须在错误中间件之前，否则 API 404 会被当作 SPA 路由）
const distPath = path.resolve(__dirname, '../dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

// 统一错误处理中间件 — 捕获路由中未处理的异常（必须放在所有路由和中间件之后）
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  const message = err?.message || '服务器内部错误';
  res.status(err?.status || 500).json({ error: message });
});

await ready;
app.listen(Number(PORT), HOST, () => console.log(`Server http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} (LAN: 0.0.0.0:${PORT})`));

process.on('SIGINT', () => { db.close(); process.exit(0); });


