// 白屏诊断层1（打包进 JS）：捕获运行期未捕获异常 / 未处理 Promise 拒绝，全屏显示错误文本。
const DIAG_KEY = '__itdc_diag__';
let logLines: string[] = [];

function pushLine(text: string) {
  const ts = new Date().toLocaleTimeString();
  logLines.push(`[${ts}] ${text}`);
  if (logLines.length > 400) logLines.shift();
}

function saveLog() {
  try { localStorage.setItem(DIAG_KEY, logLines.join('\n')); } catch { /* ignore */ }
}

function showOverlay(title: string, body: string) {
  let el = document.getElementById('__itdc_diag_overlay__');
  if (!el) {
    el = document.createElement('div');
    el.id = '__itdc_diag_overlay__';
    Object.assign(el.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647',
      background: '#b91c1c', color: '#fff', padding: '16px',
      fontFamily: 'monospace', fontSize: '13px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
    });
    document.body.appendChild(el);
  }
  el.textContent = title + '\n' + body;
  saveLog();
}

// 恢复上次崩溃信息（即使本次启动前就崩了也能看到）
try {
  const saved = localStorage.getItem(DIAG_KEY);
  if (saved) {
    pushLine('=== 上次错误 ===');
    saved.split('\n').forEach((l) => pushLine(l));
    pushLine('================');
  }
} catch { /* ignore */ }

window.addEventListener('error', (ev: any) => {
  const detail = ev.message ? String(ev.message) : '';
  const src = ev.filename || 'unknown';
  const line = ev.lineno ? `line ${ev.lineno}` : '';
  showOverlay(
    'CRASH (uncaught error)',
    `${detail}\n${src} ${line}\n\n${String(ev.error?.stack ?? '')}`
  );
});

window.addEventListener('unhandledrejection', (ev: any) => {
  const reason = ev.reason;
  let msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
  showOverlay('CRASH (unhandled rejection)', msg.slice(0, 2500));
});

const origError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const text = args
    .map((a) =>
      a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a)
    )
    .join(' | ');
  pushLine(text.slice(0, 500));
  origError(...args);
};

// 启动心跳：JS 跑起来后显示绿色提示（3秒消失），彻底没反馈时用户知道至少 JS 是活的
setTimeout(() => {
  if (!document.getElementById('__itdc_diag_overlay__')) {
    const el = document.createElement('div');
    el.id = '__itdc_diag_boot';
    Object.assign(el.style, {
      position: 'fixed', top: '8px', left: '8px', zIndex: '2147483647',
      background: 'rgba(0,0,0,0.55)', color: '#a7ff8a', padding: '2px 8px', fontSize: '11px', fontFamily: 'monospace',
    });
    document.body.appendChild(el);
    el.textContent = 'JS OK / v' + (location.href.slice(0, 90));
    setTimeout(() => el.remove(), 3000);
  }
}, 500);
// 导出避免 tree-shake 移除（模块顶层副作用）
export const __diag__ = logLines;
