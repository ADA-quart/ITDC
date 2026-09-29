// 桌面小组件数据桥：把本机今日安排整理成快照交给原生侧。
//
// 为什么需要它：仅本机模式下数据存在 WebView 的 IndexedDB 里，
// 桌面小组件运行在独立进程，读不到 WebView 存储，也没有网络可拉。
// 因此由 App 主动推送一份最小快照给原生侧持久化，小组件直接用它渲染。
import { Capacitor } from '@capacitor/core';
import type { Todo } from '../types';
import * as offline from './offline';
import { isSyncEnabled } from './client';
import { ITDCWidgetPlugin } from '../capacitor/itdc-widget';

interface WidgetScheduleItem {
  id: number;
  title: string;
  color: string;
  start: string;
  end: string;
}

interface WidgetTodoItem {
  id: number;
  title: string;
  urgency: number;
  importance: number;
  deadline: string;
}

export interface WidgetSnapshot {
  schedule: WidgetScheduleItem[];
  todos: WidgetTodoItem[];
  /** 快照所属日期（YYYY-MM-DD），原生侧用于跨天判断 */
  day: string;
  updated_at: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 转成渲染器期望的 HH:mm（与 server/routes/widget.ts 一致） */
function hhmm(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function dayKey(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 用本机数据构建小组件快照：今日已排期 + 待办 Top5（与服务器接口同结构） */
export async function buildWidgetSnapshot(): Promise<WidgetSnapshot> {
  const todos = await offline.getCachedTodos();
  const today = dayKey(new Date());

  const schedule = todos
    .filter((t) => t.status === 'scheduled' && t.scheduled_start && t.scheduled_end)
    .filter((t) => dayKey(t.scheduled_start as string) === today)
    .sort((a, b) => (a.scheduled_start as string).localeCompare(b.scheduled_start as string))
    .map((t) => ({
      id: t.id,
      title: t.title,
      color: t.color || '',
      start: hhmm(t.scheduled_start),
      end: hhmm(t.scheduled_end),
    }));

  const pending: Todo[] = todos
    .filter((t) => t.status !== 'done' && !t.completed_at)
    .sort((a, b) => {
      const scoreA = a.urgency * 10 + a.importance;
      const scoreB = b.urgency * 10 + b.importance;
      if (scoreA !== scoreB) return scoreB - scoreA;
      const da = a.deadline || '9999-12-31';
      const db = b.deadline || '9999-12-31';
      return da.localeCompare(db);
    })
    .slice(0, 5);

  return {
    schedule,
    todos: pending.map((t) => ({
      id: t.id,
      title: t.title,
      urgency: t.urgency,
      importance: t.importance,
      deadline: t.deadline ? new Date(t.deadline).toDateString() : '',
    })),
    // 快照所属日期：原生侧据此判断是否已跨天，避免第二天展示昨天的旧安排
    day: today,
    updated_at: new Date().toISOString(),
  };
}

/**
 * 把最新快照推给原生侧并触发重绘。
 * 任何数据变更后调用即可；非原生平台直接跳过。
 */
export async function pushWidgetSnapshot(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const snapshot = await buildWidgetSnapshot();
    await ITDCWidgetPlugin.pushSnapshot({
      json: JSON.stringify(snapshot),
      mode: isSyncEnabled() ? 'server' : 'local',
    });
  } catch (err) {
    // 小组件同步失败不影响主流程
    console.warn('小组件快照推送失败:', err);
  }
}

/** 切换数据模式时同步告知原生侧 */
export async function setWidgetMode(mode: 'local' | 'server'): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const snapshot = mode === 'local' ? await buildWidgetSnapshot() : null;
    await ITDCWidgetPlugin.pushSnapshot({
      json: JSON.stringify(snapshot ?? (await buildWidgetSnapshot())),
      mode,
    });
  } catch (err) {
    console.warn('小组件模式切换失败:', err);
  }
}
