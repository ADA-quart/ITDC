// 周报聚合：本周上课 / 完成待办 / 投入时长 / 连续记录周数（streak）。
// 纯函数、不依赖网络与 UI——便于单测，也让"日回顾"与"周回顾"共用口径。
import type { Todo, CalendarEvent } from '../types';
import { looksLikeCourse } from '../../shared/cdut-parser';

export interface WeeklyStats {
  /** 本周一 00:00（本地） */
  weekStart: Date;
  lessons: { count: number; minutes: number };
  /** 本周完成的待办数 */
  done: number;
  /** 其中四象限为「紧急重要」的 */
  doneImportant: number;
  /** 完成待办的预估时长合计（分钟） */
  doneMinutes: number;
  /** 本周新建的待办数 */
  created: number;
  /** 周一~周日 每天完成数 */
  perDay: number[];
  /** 上周完成数；上周没有完成记录时为 null（新用户不显示对比） */
  lastWeekDone: number | null;
  /** 连续多少周有完成记录（本周仍在进行中，未完成不打断 streak） */
  streakWeeks: number;
  /** 本周内过了截止时间还没完成的（周回顾里的"欠账"） */
  overdueThisWeek: Array<{ id: number; title: string; deadline: string }>;
  /** 本周完成的、当初超过截止时间的（"补上的账"，正面反馈） */
  caughtUpThisWeek: number;
}

/** 一周的起点：周一 00:00 */
export function weekStartOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0=周日
  const offset = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - offset);
  return x;
}

function completedAtOf(td: Todo): number | null {
  if (!td.completed_at) return null;
  const ts = new Date(td.completed_at).getTime();
  return Number.isNaN(ts) ? null : ts;
}

export function computeWeeklyStats(
  todos: Todo[],
  events: CalendarEvent[],
  now: Date = new Date()
): WeeklyStats {
  const start = weekStartOf(now);
  const startMs = start.getTime();
  const endMs = startMs + 7 * 86400_000;
  const prevStartMs = startMs - 7 * 86400_000;

  // ---- 上课：开始时间落在本周、且像课程的事件 ----
  let lessonCount = 0;
  let lessonMinutes = 0;
  for (const ev of events) {
    if (!ev?.start_time) continue;
    const s = new Date(ev.start_time).getTime();
    if (Number.isNaN(s) || s < startMs || s >= endMs) continue;
    if (!looksLikeCourse(ev)) continue;
    lessonCount++;
    const e = ev.end_time ? new Date(ev.end_time).getTime() : s;
    if (!Number.isNaN(e) && e > s) lessonMinutes += Math.round((e - s) / 60000);
  }

  // ---- 完成 / 新建 / 每日分布 / 上周 ----
  let done = 0;
  let doneImportant = 0;
  let doneMinutes = 0;
  let created = 0;
  let lastWeekDone = 0;
  const perDay = [0, 0, 0, 0, 0, 0, 0];
  for (const td of todos) {
    const c = completedAtOf(td);
    if (c !== null) {
      if (c >= startMs && c < endMs) {
        done++;
        if (td.priority === 'urgent-important') doneImportant++;
        doneMinutes += td.estimated_minutes || 0;
        const idx = Math.floor((c - startMs) / 86400_000);
        if (idx >= 0 && idx < 7) perDay[idx]++;
      } else if (c >= prevStartMs && c < startMs) {
        lastWeekDone++;
      }
    }
    const ca = td.created_at ? new Date(td.created_at).getTime() : NaN;
    if (!Number.isNaN(ca) && ca >= startMs && ca < endMs) created++;
  }

  // ---- streak：从本周往回数"有完成记录"的连续周 ----
  const weeksWithDone = new Set<number>();
  for (const td of todos) {
    const c = completedAtOf(td);
    if (c !== null) weeksWithDone.add(weekStartOf(new Date(c)).getTime());
  }
  let streakWeeks = 0;
  const cursor = new Date(start);
  // 本周还没完成不算断（周还在进行中）——从前一周开始数
  if (!weeksWithDone.has(cursor.getTime())) cursor.setDate(cursor.getDate() - 7);
  while (weeksWithDone.has(cursor.getTime())) {
    streakWeeks++;
    cursor.setDate(cursor.getDate() - 7);
  }

  // ---- 本周逾期：deadline 落在本周、已过、且未完成 ----
  const overdueThisWeek: Array<{ id: number; title: string; deadline: string }> = [];
  for (const td of todos) {
    if (td.status === 'done' || td.completed_at) continue;
    if (!td.deadline) continue;
    const d = new Date(td.deadline).getTime();
    if (Number.isNaN(d)) continue;
    if (d < now.getTime() && d >= startMs && d < endMs) {
      overdueThisWeek.push({ id: td.id, title: td.title, deadline: td.deadline });
    }
  }
  overdueThisWeek.sort((a, b) => a.deadline.localeCompare(b.deadline));

  // ---- 本周补账：完成时间晚于截止时间、且完成发生在本周 ----
  let caughtUpThisWeek = 0;
  for (const td of todos) {
    const c = completedAtOf(td);
    if (c === null || c < startMs || c >= endMs) continue;
    if (!td.deadline) continue;
    const d = new Date(td.deadline).getTime();
    if (!Number.isNaN(d) && c > d) caughtUpThisWeek++;
  }

  return {
    weekStart: start,
    lessons: { count: lessonCount, minutes: lessonMinutes },
    done,
    doneImportant,
    doneMinutes,
    created,
    perDay,
    lastWeekDone: lastWeekDone > 0 ? lastWeekDone : null,
    streakWeeks,
    overdueThisWeek,
    caughtUpThisWeek,
  };
}
