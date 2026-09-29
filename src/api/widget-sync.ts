// 桌面小组件数据桥：把本机安排整理成快照交给原生侧。
//
// 为什么需要它：仅本机模式下数据存在 WebView 的 IndexedDB 里，
// 桌面小组件运行在独立进程，读不到 WebView 存储，也没有网络可拉。
// 因此由 App 主动推送一份最小快照给原生侧持久化，小组件直接用它渲染。
import { Capacitor } from '@capacitor/core';
import type { CalendarEvent, Todo } from '../types';
import * as offline from './offline';
import { isSyncEnabled } from './client';
import { ITDCWidgetPlugin } from '../capacitor/itdc-widget';

/** 单条课程/日程：今天与明天共用同一结构 */
export interface WidgetScheduleItem {
  id: number;
  title: string;
  color: string;
  start: string;
  end: string;
  location: string;
}

export interface WidgetTodoItem {
  id: number;
  title: string;
  urgency: number;
  importance: number;
  priority: string;
  deadline: string;
  /** 已排期时段（HH:mm-HH:mm），未排程为空 */
  slot: string;
}

export interface WidgetSnapshot {
  /** 今天已排期（含事件与已排期待办），按开始时间升序 */
  schedule: WidgetScheduleItem[];
  /** 明天已排期，用于"明天没有课啦"这类提示 */
  tomorrow: WidgetScheduleItem[];
  /** 今天与明天的日期标签，如 9.29 / 9.30 */
  todayLabel: string;
  tomorrowLabel: string;
  /** 教学周次文案，如 "第5周"（无数据时为空） */
  weekLabel: string;
  /** 顶栏左侧标题，如 "大三上"（取自日历名，无则空） */
  boardTitle: string;
  todos: WidgetTodoItem[];
  /** 快照所属日期（YYYY-MM-DD），原生侧用于跨天判断 */
  day: string;
  updated_at: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** HH:mm */
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

/** 9.29 这样的短日期 */
function shortDate(d: Date): string {
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

/**
 * 计算教学周次：以当年 9 月 1 日所在周为第 1 周。
 * 仅用于小组件顶栏展示，学期口径与学校实际校历可能不同。
 */
function teachingWeek(d: Date): number {
  const year = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  const start = new Date(year, 8, 1);
  const day = start.getDay();
  const diff = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - diff);
  start.setHours(0, 0, 0, 0);
  const cur = new Date(d);
  cur.setHours(0, 0, 0, 0);
  const weeks = Math.floor((cur.getTime() - start.getTime()) / (7 * 24 * 3600_000)) + 1;
  return weeks > 0 ? weeks : 0;
}

/** 从事件与已排期待办中筛出某一天的条目 */
function scheduleForDay(
  day: string,
  events: CalendarEvent[],
  todos: Todo[],
  calendarColorById: Map<number, string>
): WidgetScheduleItem[] {
  const fromEvents: WidgetScheduleItem[] = events
    .filter((e) => dayKey(e.start_time) === day)
    .map((e) => ({
      id: e.id,
      title: e.title,
      color: e.calendar_color || calendarColorById.get(e.calendar_id) || '#4c9aff',
      start: hhmm(e.start_time),
      end: hhmm(e.end_time),
      location: e.location || '',
    }));

  const fromTodos: WidgetScheduleItem[] = todos
    .filter((t) => t.status === 'scheduled' && t.scheduled_start && t.scheduled_end)
    .filter((t) => dayKey(t.scheduled_start as string) === day)
    .map((t) => ({
      id: t.id,
      title: t.title,
      color: t.color || '#4c9aff',
      start: hhmm(t.scheduled_start),
      end: hhmm(t.scheduled_end),
      location: '',
    }));

  return [...fromEvents, ...fromTodos].sort((a, b) => a.start.localeCompare(b.start));
}

/** 用本机数据构建小组件快照：今天 + 明天课表，以及待办清单 */
export async function buildWidgetSnapshot(): Promise<WidgetSnapshot> {
  const todos = await offline.getCachedTodos();
  const events = await offline.getEventCache();
  const calendars = await offline.getCalendarCache();

  const calendarColorById = new Map(calendars.map((c) => [c.id, c.color]));
  const now = new Date();
  const today = dayKey(now);
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = dayKey(tomorrowDate);

  const schedule = scheduleForDay(today, events, todos, calendarColorById);
  const tomorrowItems = scheduleForDay(tomorrow, events, todos, calendarColorById);

  // 待办：未完成，按四象限优先级 + 截止时间排序；取 8 条供列表滚动
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
    .slice(0, 8);

  const week = teachingWeek(now);

  return {
    schedule,
    tomorrow: tomorrowItems,
    todayLabel: shortDate(now),
    tomorrowLabel: shortDate(tomorrowDate),
    weekLabel: week > 0 ? `${week}` : '',
    boardTitle: calendars[0]?.name || '',
    todos: pending.map((t) => ({
      id: t.id,
      title: t.title,
      urgency: t.urgency,
      importance: t.importance,
      priority: t.priority,
      deadline: t.deadline ? `${new Date(t.deadline).getMonth() + 1}/${new Date(t.deadline).getDate()}` : '',
      slot: t.scheduled_start && t.scheduled_end
        ? `${hhmm(t.scheduled_start)}-${hhmm(t.scheduled_end)}`
        : '',
    })),
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
    const snapshot = await buildWidgetSnapshot();
    await ITDCWidgetPlugin.pushSnapshot({ json: JSON.stringify(snapshot), mode });
  } catch (err) {
    console.warn('小组件模式切换失败:', err);
  }
}