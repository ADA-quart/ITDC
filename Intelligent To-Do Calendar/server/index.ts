import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import calendarRouter from './routes/calendar.js';
import todoRouter from './routes/todo.js';
import scheduleRouter from './routes/schedule.js';
import db, { ready } from './db/index.js';

// Windows chcp 65001
if (process.platform === 'win32') { try { execSync('chcp 65001', { stdio: 'pipe' }); } catch {} }

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;
const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/calendar', calendarRouter);
app.use('/api/todos', todoRouter);
app.use('/api/schedule', scheduleRouter);

const distPath = path.resolve(__dirname, '../dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

// 等待数据库初始化完成后再启动服务器，确保所有路由可用
await ready;
app.listen(PORT, () => console.log('Server http://localhost:' + PORT));

process.on('SIGINT', () => { db.close(); process.exit(0); });
