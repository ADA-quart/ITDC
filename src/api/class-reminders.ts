/**
 * 上课提醒（教务课表导入的课程事件）——纯逻辑与本地设置。
 *
 * 真正的通知排程见 src/api/reminders.ts（依赖 Capacitor 插件）；
 * 这里保持零原生依赖，便于单测。
 */
import type { CalendarEvent } from '../types';
import { SCHOOLS } from '../../shared/schools';

/** 通知 id 命名空间：待办通知用自身 id（小整数），上课提醒 +10 亿，两套互不覆盖 */
export const CLASS_NOTIFICATION_ID_BASE = 1_000_000_000;

/**
 * 本地通知最多提前 45 天。
 *
 * 每节课都是一条待触发的本机通知（Android 上落到 AlarmManager），排得越远
 * 挂起的闹钟越多、耗电越高；而每次打开 App 读取日历时都会按最新课表重排，
 * 45 天足够覆盖「假期回来打开一次」的间隔。
 */
export const CLASS_MAX_AHEAD_MS = 45 * 24 * 3600_000;

const CLASS_REMINDER_KEY = 'itdc_class_reminder_enabled';
const CLASS_LEAD_KEY = 'itdc_class_reminder_lead_min';

export const DEFAULT_CLASS_LEAD_MIN = 10;
export const CLASS_LEAD_OPTIONS = [5, 10, 15, 20, 30];

export function getClassReminderEnabled(): boolean {
  try {
    const raw = localStorage.getItem(CLASS_REMINDER_KEY);
    if (raw === null) return true; // 默认开启
    return raw !== 'false';
  } catch { return false; }
}

export function setClassReminderEnabled(on: boolean): void {
  try { localStorage.setItem(CLASS_REMINDER_KEY, String(on)); } catch {}
}

export function getClassReminderLeadMin(): number {
  try {
    const n = parseInt(localStorage.getItem(CLASS_LEAD_KEY) ?? '', 10);
    if (Number.isFinite(n) && n >= 1 && n <= 120) return n;
  } catch { /* 读取失败回退默认值 */ }
  return DEFAULT_CLASS_LEAD_MIN;
}

export function setClassReminderLeadMin(min: number): void {
  try { localStorage.setItem(CLASS_LEAD_KEY, String(min)); } catch {}
}

/** 是否教务课表导入的课程事件：source 命中学校注册表 */
export function isClassEvent(e: CalendarEvent): boolean {
  return !!e.source && !!SCHOOLS[e.source];
}

export interface ClassReminderPlan {
  id: number;
  title: string;
  body: string;
  at: Date;
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 课表导入时 description = [教师, 周次, 节次]，取首行当教师（「第x周」开头则不是教师） */
function teacherOf(description: string | null): string {
  const first = (description ?? '').split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? '';
  return first.startsWith('第') ? '' : first;
}

/**
 * 计算需要排程的上课提醒（纯函数）。
 * 跳过：非课表事件、重复事件（rrule）、已过期或 30 秒内、90 天以外。
 */
export function planClassReminders(
  events: CalendarEvent[],
  now: number = Date.now(),
  leadMin: number = getClassReminderLeadMin(),
): ClassReminderPlan[] {
  const plans: ClassReminderPlan[] = [];
  for (const e of events) {
    if (!isClassEvent(e) || e.rrule) continue;
    const start = new Date(e.start_time).getTime();
    if (!Number.isFinite(start)) continue;
    if (start - now > CLASS_MAX_AHEAD_MS) continue;
    const at = start - leadMin * 60_000;
    if (at - now < 30_000) continue; // 来不及提醒就不打扰
    const body = [
      `${hhmm(new Date(start))} 上课`,
      (e.location ?? '').trim(),
      teacherOf(e.description),
    ].filter(Boolean).join(' · ');
    plans.push({
      id: CLASS_NOTIFICATION_ID_BASE + (e.id % CLASS_NOTIFICATION_ID_BASE),
      title: e.title,
      body,
      at: new Date(at),
    });
  }
  return plans;
}
