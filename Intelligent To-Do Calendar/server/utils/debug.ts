import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_DIR = path.resolve(__dirname, '../../data');
const LOG_FILE = path.join(LOG_DIR, 'debug.log');
const MAX_LINES = 10;

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function trimLog(): void {
  if (!fs.existsSync(LOG_FILE)) return;
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf-8').trim();
    if (!content) return;
    const lines = content.split('\n');
    if (lines.length <= MAX_LINES) return;
    const trimmed = lines.slice(-MAX_LINES).join('\n') + '\n';
    fs.writeFileSync(LOG_FILE, trimmed, 'utf-8');
  } catch {}
}

function append(level: string, message: string, detail?: any): void {
  let line = `[${timestamp()}] [${level}] ${message}`;
  if (detail !== undefined) {
    const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2);
    line += ' | ' + detailStr.replace(/\n/g, '\\n');
  }
  line += '\n';
  try {
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
  } catch {}
  trimLog();
}

export const debug = {
  info(message: string, detail?: any) { append('INFO', message, detail); },
  warn(message: string, detail?: any) { append('WARN', message, detail); },
  error(message: string, detail?: any) { append('ERROR', message, detail); },
  getLog(): string {
    try {
      return fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf-8').trim() : '';
    } catch {
      return '';
    }
  },
  clear() {
    try {
      if (fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '', 'utf-8');
    } catch {}
  },
};
