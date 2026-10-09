// 桌面小组件数据桥：把本机安排整理成快照交给原生侧。
//
// 为什么需要它：仅本机模式下数据存在 WebView 的 IndexedDB 里，
// 桌面小组件运行在独立进程，读不到 WebView 存储，也没有网络可拉。
// 因此由 App 主动推送一份最小快照给原生侧持久化，小组件直接用它渲染。
import { Capacitor } from '@capacitor/core';
import { RRule } from 'rrule';
import type { CalendarEvent, Todo } from '../types';
import * as offline from './offline';
import { isSyncEnabled } from './client';
import { ITDCWidgetPlugin } from '../capacitor/itdc-widget';
import { dedupeEvents } from '../../shared/event-dedupe';
import { widgetLocationLabel } from '../../shared/widget-display';

const HIDDEN_CALENDARS_KEY = 'itdc_hidden_calendars';

function getHiddenCalendarIds(): Set<number> {
  try {
    const raw = localStorage.getItem(HIDDEN_CALENDARS_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'number') : []);
  } catch {
    return new Set();
  }
}

/** 单条课程/日程：今天与明天共用同一结构 */
export interface WidgetScheduleItem {
  id: number;
  title: string;
  color: string;
  start: string;
  end: string;
  location: string;
  /** 来源日历 id：用于判断"最近有课的是哪个日历" */
  calendarId: number;
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
  /** 是否已完成：原生端据此显示复选框与划线 */
  done: boolean;
}

/** 单天的安排（跨天渲染用：快照一次覆盖多天，小组件自行选取"今天"） */
export interface WidgetDaySchedule {
  /** YYYY-MM-DD */
  date: string;
  /** 短日期标签，如 10.9 */
  label: string;
  /** 教学周次文案，如 "5"（取不到时为空） */
  weekLabel: string;
  /** 当天第一节课所属日历名（无课为空） */
  boardTitle: string;
  items: WidgetScheduleItem[];
}

export interface WidgetSnapshot {
  /**
   * 今天起连续 7 天的安排：小组件按当前日期自行选取「今天 / 明天」，
   * 跨天后即使 App 没有再次推送也能正确显示，直到覆盖范围用完。
   */
  days: WidgetDaySchedule[];
  /** 今天已排期（含事件与已排期待办），按开始时间升序 */
  schedule: WidgetScheduleItem[];
  /** 明天已排期，用于"明天没有课啦"这类提示 */
  tomorrow: WidgetScheduleItem[];
  /** 今天与明天的日期标签，如 9.29 / 9.30 */
  todayLabel: string;
  tomorrowLabel: string;
  /** 教学周次文案，如 "5"（无数据时为空） */
  weekLabel: string;
  /** 顶栏标题：最近有课的那个日历名（无课或取不到时为空） */
  boardTitle: string;
  todos: WidgetTodoItem[];
  /** 快照所属日期（YYYY-MM-DD），原生侧用于跨天判断 */
  day: string;
  updated_at: string;
}

/** 快照覆盖天数：7 天足够应付一周不打开 App 的情况 */
const SNAPSHOT_DAYS = 7;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** HH:mm */
function hhmm(value: string | Date | null): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function dayKey(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dayStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
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
  const cur = dayStart(d);
  const weeks = Math.floor((cur.getTime() - start.getTime()) / (7 * 24 * 3600_000)) + 1;
  return weeks > 0 ? weeks : 0;
}

/**
 * 展开某个事件在指定日期内的所有实际发生时间。
 *
 * 课程表里的课通常是 RRULE 重复规则（每周固定），只按 start_time 匹配日期
 * 会导致这些课从第二周起就消失在小组件里。这里用 rrule 展开真实发生时间。
 */
function occurrencesOnDay(
  event: CalendarEvent,
  target: Date
): { start: Date; end: Date }[] {
  const firstStart = new Date(event.start_time);
  const firstEnd = new Date(event.end_time);
  if (Number.isNaN(firstStart.getTime()) || Number.isNaN(firstEnd.getTime())) return [];

  const from = dayStart(target);
  const to = new Date(from.getTime() + 24 * 3600_000);
  const durationMs = Math.max(0, firstEnd.getTime() - firstStart.getTime());

  // 非重复事件：直接判断是否落在当天
  if (!event.rrule) {
    if (firstStart >= from && firstStart < to) return [{ start: firstStart, end: firstEnd }];
    return [];
  }

  try {
    const parsed = RRule.parseString(event.rrule.replace(/^RRULE:/i, ''));
    parsed.dtstart = firstStart;
    const rule = new RRule(parsed);
    // 往前多取一个时长，覆盖"昨天开始、今天仍在进行"的跨天事件
    const occurrences = rule.between(
      new Date(from.getTime() - durationMs),
      to,
      true
    );
    return occurrences
      .map((occ) => ({ start: occ, end: new Date(occ.getTime() + durationMs) }))
      .filter((o) => o.end > from && o.start < to);
  } catch {
    // RRULE 解析失败时退化为"只看首次发生"，不影响其它事件
    if (firstStart >= from && firstStart < to) return [{ start: firstStart, end: firstEnd }];
    return [];
  }
}

/** 从事件与已排期待办中筛出某一天的实际条目（含重复规则展开） */
function scheduleForDay(
  day: Date,
  events: CalendarEvent[],
  todos: Todo[],
  calendarColorById: Map<number, string>
): WidgetScheduleItem[] {
  const dayTag = dayKey(day);

  const fromEvents: WidgetScheduleItem[] = [];
  for (const e of events) {
    for (const occ of occurrencesOnDay(e, day)) {
      fromEvents.push({
        id: e.id,
        title: e.title,
        // 课程配色优先（导入的课表每个课程一个色），其次日历色
        color: e.color || e.calendar_color || calendarColorById.get(e.calendar_id) || '#4c9aff',
        start: hhmm(occ.start),
        end: hhmm(occ.end),
        location: widgetLocationLabel(e),
        calendarId: e.calendar_id,
      });
    }
  }

  const fromTodos: WidgetScheduleItem[] = todos
    .filter((t) => t.status === 'scheduled' && t.scheduled_start && t.scheduled_end)
    .filter((t) => dayKey(t.scheduled_start as string) === dayTag)
    .map((t) => ({
      id: t.id,
      title: t.title,
      color: t.color || '#4c9aff',
      start: hhmm(t.scheduled_start),
      end: hhmm(t.scheduled_end),
      location: '',
      calendarId: 0,
    }));

  return [...fromEvents, ...fromTodos].sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * 找出"最近有课的那个日历"：按 今天剩余课程 → 明天课程 的顺序取最近一场，
 * 返回它所属的日历名。都没有课时返回空串。
 */
function nearestClassCalendarName(
  todayItems: WidgetScheduleItem[],
  tomorrowItems: WidgetScheduleItem[],
  now: Date,
  calendarNameById: Map<number, string>
): string {
  const nowHm = hhmm(now);

  const upcomingToday = todayItems.filter((i) => i.start >= nowHm);
  const candidates = upcomingToday.length > 0 ? upcomingToday : tomorrowItems;

  for (const item of candidates) {
    const name = calendarNameById.get(item.calendarId);
    if (name) return name;
  }
  return '';
}

/** 当天第一条有日历名的条目：跨天渲染时用它当顶栏标题 */
function firstCalendarName(
  items: WidgetScheduleItem[],
  calendarNameById: Map<number, string>
): string {
  for (const item of items) {
    const name = calendarNameById.get(item.calendarId);
    if (name) return name;
  }
  return '';
}

/** 用本机数据构建小组件快照：今天起 7 天课表，以及待办清单 */
export async function buildWidgetSnapshot(): Promise<WidgetSnapshot> {
  const todos = await offline.getCachedTodos();
  const events = await offline.getEventCache();
  const calendars = await offline.getCalendarCache();
  const hiddenCalendarIds = getHiddenCalendarIds();
  // 同一门课被教务 + 多个 iCal 重复导入时，小组件也只显示一条
  const visibleEvents = dedupeEvents(events.filter((event) => !hiddenCalendarIds.has(event.calendar_id)));

  const calendarColorById = new Map(calendars.map((c) => [c.id, c.color]));
  const calendarNameById = new Map(calendars.map((c) => [c.id, c.name]));

  const now = new Date();
  const todayDate = dayStart(now);
  const tomorrowDate = new Date(todayDate);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);

  const schedule = scheduleForDay(todayDate, visibleEvents, todos, calendarColorById);
  const tomorrowItems = scheduleForDay(tomorrowDate, visibleEvents, todos, calendarColorById);

  // 未来 7 天逐天展开：小组件端按当前日期选取，跨天无需 App 重新推送
  const days: WidgetDaySchedule[] = [];
  for (let i = 0; i < SNAPSHOT_DAYS; i++) {
    const day = new Date(todayDate);
    day.setDate(day.getDate() + i);
    const items = i === 0
      ? schedule
      : i === 1
        ? tomorrowItems
        : scheduleForDay(day, visibleEvents, todos, calendarColorById);
    const week = teachingWeek(day);
    days.push({
      date: dayKey(day),
      label: shortDate(day),
      weekLabel: week > 0 ? `${week}` : '',
      boardTitle: firstCalendarName(items, calendarNameById),
      items,
    });
  }

  // 待办：未完成优先，今天刚完成的排在末尾（保留划线效果到当天结束），
  // 隔天不再展示。整体按四象限优先级 + 截止时间排序。
  const isDone = (t: Todo) => t.status === 'done' || !!t.completed_at;
  const doneToday = (t: Todo) => {
    if (!t.completed_at) return false;
    return dayKey(t.completed_at) === dayKey(now);
  };

  const sortedTodos = [...todos].sort((a, b) => {
    const scoreA = a.urgency * 10 + a.importance;
    const scoreB = b.urgency * 10 + b.importance;
    if (scoreA !== scoreB) return scoreB - scoreA;
    const da = a.deadline || '9999-12-31';
    const db = b.deadline || '9999-12-31';
    return da.localeCompare(db);
  });

  const pending = [
    ...sortedTodos.filter((t) => !isDone(t)),
    ...sortedTodos.filter((t) => isDone(t) && doneToday(t)),
  ].slice(0, 10);

  const week = teachingWeek(now);

  return {
    days,
    schedule,
    tomorrow: tomorrowItems,
    todayLabel: shortDate(now),
    tomorrowLabel: shortDate(tomorrowDate),
    weekLabel: week > 0 ? `${week}` : '',
    boardTitle: nearestClassCalendarName(schedule, tomorrowItems, now, calendarNameById),
    todos: pending.map((t) => ({
      id: t.id,
      title: t.title,
      urgency: t.urgency,
      importance: t.importance,
      priority: t.priority,
      done: t.status === 'done' || !!t.completed_at,
      deadline: t.deadline ? `${new Date(t.deadline).getMonth() + 1}/${new Date(t.deadline).getDate()}` : '',
      slot: t.scheduled_start && t.scheduled_end
        ? `${hhmm(t.scheduled_start)}-${hhmm(t.scheduled_end)}`
        : '',
    })),
    day: dayKey(now),
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

/**
 * 消费桌面上的"打勾完成"操作，写回本地数据库。
 *
 * 小组件读不到 WebView 的 IndexedDB，所以在桌面打勾只能先记在原生侧的队列里：
 * 桌面立刻显示划线，App 下次启动/回到前台时把队列合并进数据库，再清空。
 * 写回失败时保留队列，下次重试，避免桌面状态与数据库永久不一致。
 *
 * @returns 实际写回的条数（0 表示没有待处理的操作）
 */
export async function consumeWidgetDoneQueue(): Promise<number> {
  if (!Capacitor.isNativePlatform()) return 0;

  let queue: { done: number[]; undone: number[] };
  try {
    queue = await ITDCWidgetPlugin.getDoneQueue();
  } catch {
    return 0;
  }

  const doneIds = Array.isArray(queue?.done) ? queue.done : [];
  const undoneIds = Array.isArray(queue?.undone) ? queue.undone : [];
  if (doneIds.length === 0 && undoneIds.length === 0) return 0;

  try {
    const todos = await offline.getCachedTodos();
    const nowIso = new Date().toISOString();
    let changed = 0;

    const next = todos.map((t) => {
      if (doneIds.includes(t.id) && t.status !== 'done') {
        changed++;
        return { ...t, status: 'done' as const, completed_at: nowIso };
      }
      if (undoneIds.includes(t.id) && (t.status === 'done' || t.completed_at)) {
        changed++;
        return { ...t, status: 'pending' as const, completed_at: null };
      }
      return t;
    });

    if (changed > 0) {
      await offline.saveCachedTodos(next);
      window.dispatchEvent(new CustomEvent('itdc-widget-sync'));
    }

    // 即使某条 id 已不存在（被别处删除），也算处理完毕：继续留在队列只会无限重试
    await ITDCWidgetPlugin.clearDoneQueue();
    return changed;
  } catch (err) {
    console.warn('小组件完成状态回写失败，保留队列待下次重试:', err);
    return 0;
  }
}
