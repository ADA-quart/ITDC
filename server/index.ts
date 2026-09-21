import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import calendarRouter from './routes/calendar.js';
import todoRouter from './routes/todo.js';
import scheduleRouter from './routes/schedule.js';
import settingsRouter from './routes/settings.js';
import db, { ready } from './db/index.js';

if (process.platform === 'win32') { try { execSync('chcp 65001', { stdio: 'pipe' }); } catch {} }

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const app = express();

// CORS：允许 localhost 及局域网 IP 访问（开发模式 Vite 5173 + 生产模式同端口）
app.use(cors({
  origin: (origin, callback) => {
    // 允许无 origin 的请求（如 curl、服务端调用）
    if (!origin) return callback(null, true);
    try {
      const url = new URL(origin);
      if (
        url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        // 允许局域网 IP (10.x / 172.16-31.x / 192.168.x)
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname) ||
        /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(url.hostname) ||
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(url.hostname)
      ) {
        return callback(null, true);
      }
    } catch {}
    callback(null, false);
  },
  credentials: true,
}));
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/calendar', calendarRouter);
app.use('/api/todos', todoRouter);
app.use('/api/schedule', scheduleRouter);
app.use('/api/settings', settingsRouter);

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
