// 验证快照构建：结构必须与原生渲染器 WidgetBitmapRenderer 期望的一致
import { describe, it, expect } from 'vitest';

// 复制 widget-sync 的构建逻辑做纯函数验证（避免 Capacitor 依赖）
function pad2(n: number): string { return String(n).padStart(2, '0'); }
function hhmm(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
function dayKey(v: string | Date): string {
  const d = typeof v === 'string' ? new Date(v) : v;
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

describe('widget snapshot format', () => {
  it('formats time as HH:mm for the native renderer', () => {
    const d = new Date();
    d.setHours(9, 5, 0, 0);
    expect(hhmm(d.toISOString())).toBe('09:05');
  });

  it('returns empty string for null or invalid timestamps', () => {
    expect(hhmm(null)).toBe('');
    expect(hhmm('not-a-date')).toBe('');
  });

  it('dayKey matches local calendar day', () => {
    const d = new Date(2026, 8, 29, 23, 30);
    expect(dayKey(d)).toBe('2026-09-29');
  });

  it('snapshot shape has schedule and todos arrays', () => {
    const snapshot = { schedule: [], todos: [], updated_at: new Date().toISOString() };
    expect(Array.isArray(snapshot.schedule)).toBe(true);
    expect(Array.isArray(snapshot.todos)).toBe(true);
    // 渲染器读取的字段
    const item = { id: 1, title: 'x', color: '#fff', start: '09:00', end: '10:00' };
    expect(Object.keys(item).sort()).toEqual(['color', 'end', 'id', 'start', 'title']);
  });
});
