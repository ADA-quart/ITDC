import { Capacitor } from '@capacitor/core';
import type { Todo, CalendarEvent } from '../types';
import { LocalNotifications } from '@capacitor/local-notifications';
import {
  CLASS_NOTIFICATION_ID_BASE,
  getClassReminderEnabled,
  planClassReminders,
} from './class-reminders';

const REMINDER_KEY = 'itdc_reminder_enabled';
// 通知权限是否已经弹过窗（用户拒绝后不再每次启动都打扰；设置里手动开启会重置）
const PERM_ASKED_KEY = 'itdc_class_reminder_perm_asked';
const CLASS_CHANNEL_ID = 'class-reminders';
// Android 的通知渠道创建后不能改重要性，所以「响铃 / 静默」用两个渠道，
// 由设置里的开关决定排程时走哪个
const CLASS_CHANNEL_SILENT_ID = 'class-reminders-silent';
const CLASS_SILENT_KEY = 'itdc_class_reminder_silent';
// 本地通知最多提前 90 天，超出则不排程（Android 对过远的定时通知行为不一致）
const MAX_AHEAD_MS = 90 * 24 * 3600_000;

export function isAndroid(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch { /* ignore */ }
  const ua = navigator.userAgent || '';
  return /Android/i.test(ua);
}

export function getReminderEnabled(): boolean {
  try {
    const raw = localStorage.getItem(REMINDER_KEY);
    if (raw === null) return true; // 默认开启
    return raw !== 'false';
  } catch { return false; }
}

export function setReminderEnabled(on: boolean): void {
  try { localStorage.setItem(REMINDER_KEY, String(on)); } catch {}
}

/** 上课提醒是否静默（只显示在通知栏，不响铃不震动） */
export function getClassReminderSilent(): boolean {
  try { return localStorage.getItem(CLASS_SILENT_KEY) === 'true'; } catch { return false; }
}

export function setClassReminderSilent(on: boolean): void {
  try { localStorage.setItem(CLASS_SILENT_KEY, String(on)); } catch {}
}

function classChannelId(): string {
  return getClassReminderSilent() ? CLASS_CHANNEL_SILENT_ID : CLASS_CHANNEL_ID;
}

// 提醒时间：优先已排程开始时间，其次截止时间；必须在未来且不超过 MAX_AHEAD_MS
export function reminderTimeFor(todo: Todo): Date | null {
  const candidates: string[] = [];
  if (todo.scheduled_start) candidates.push(todo.scheduled_start);
  if (todo.deadline) candidates.push(todo.deadline);
  for (const s of candidates) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const delta = d.getTime() - Date.now();
      if (delta > 60_000 && delta < MAX_AHEAD_MS) return d;
    }
  }
  return null;
}



export async function scheduleTodoReminder(todo: Todo): Promise<void> {
  try {
    if (!isAndroid() || !getReminderEnabled()) return;
    const time = reminderTimeFor(todo);
    if (!time) return;
    await LocalNotifications.schedule({
      notifications: [
        {
          id: todo.id,
          title: todo.title,
          body: '提醒：' + todo.title,
          schedule: { at: time },
        },
      ],
    });
  } catch (err) {
    // 通知排程失败不影响主流程（如权限未授予）
    console.warn('scheduleTodoReminder failed:', err);
  }
}

export async function cancelTodoReminder(id: number): Promise<void> {
  try {
    if (!isAndroid()) return;
    await LocalNotifications.cancel({ notifications: [{ id: id }] });
  } catch (err) {
    console.warn('cancelTodoReminder failed:', err);
  }
}

// 全量重排：取消所有已排程待办通知，再为符合条件的逐个重新排程。
// 用于 todo 列表重载后统一同步（覆盖创建/更新/删除/拆分/拖拽等所有变更路径）。
export async function syncAllReminders(todos: Todo[]): Promise<void> {
  try {
    if (!isAndroid()) return;
    // 只清理待办命名空间（id < CLASS_NOTIFICATION_ID_BASE）的通知，
    // 避免把上课提醒一起取消（两套排程互相独立）
    await cancelPendingWhere((id) => id < CLASS_NOTIFICATION_ID_BASE);
    for (const todo of todos) {
      if (getReminderEnabled() && reminderTimeFor(todo)) {
        await scheduleTodoReminder(todo);
      }
    }
  } catch (err) {
    console.warn('syncAllReminders failed:', err);
  }
}

// ---------- 上课提醒（教务课表导入的课程） ----------

/** 取消满足条件的已排程通知；查询失败时按「没有待取消」处理 */
async function cancelPendingWhere(keep: (id: number) => boolean): Promise<void> {
  try {
    const pending = await LocalNotifications.getPending();
    const targets = (pending.notifications ?? [])
      .filter((n) => keep(n.id))
      .map((n) => ({ id: n.id }));
    if (targets.length > 0) {
      await LocalNotifications.cancel({ notifications: targets });
    }
  } catch (err) {
    console.warn('cancelPendingWhere failed:', err);
  }
}

/** 请求通知权限；用户拒绝后记录标记，避免每次启动重复弹窗 */
export async function requestClassReminderPermission(): Promise<boolean> {
  try {
    if (!isAndroid()) return false;
    const cur = await LocalNotifications.checkPermissions();
    if (cur.display === 'granted') return true;
    const res = await LocalNotifications.requestPermissions();
    try { localStorage.setItem(PERM_ASKED_KEY, 'true'); } catch {}
    return res.display === 'granted';
  } catch (err) {
    console.warn('requestClassReminderPermission failed:', err);
    return false;
  }
}

/**
 * 按最新日历事件重排上课提醒：先清掉本命名空间旧排程，再为未来 90 天内的
 * 课表事件逐个排程（通知内容＝课程名 + 时间 + 教室 + 教师）。
 */
export async function syncClassReminders(events: CalendarEvent[]): Promise<void> {
  try {
    if (!isAndroid()) return;
    await cancelPendingWhere((id) => id >= CLASS_NOTIFICATION_ID_BASE);
    if (!getClassReminderEnabled()) return;

    const plans = planClassReminders(events);
    if (plans.length === 0) return;

    // 权限：Android 13+ 首次需要用户授权；已拒绝过就不再自动弹窗
    let asked = false;
    try { asked = localStorage.getItem(PERM_ASKED_KEY) === 'true'; } catch {}
    const perm = await LocalNotifications.checkPermissions().catch(() => null);
    if (perm && perm.display !== 'granted') {
      if (asked) return;
      const ok = await requestClassReminderPermission();
      if (!ok) return;
    }

    // 独立通知渠道（响铃 / 静默各一个），用户也能在系统里单独调
    try {
      await LocalNotifications.createChannel({
        id: CLASS_CHANNEL_ID,
        name: '上课提醒',
        description: '上课前的课程与教室提醒',
        importance: 4,
      });
      await LocalNotifications.createChannel({
        id: CLASS_CHANNEL_SILENT_ID,
        name: '上课提醒（静默）',
        description: '只在通知栏显示，不响铃、不震动',
        importance: 2,
      });
    } catch { /* 渠道已存在或平台不支持，不影响排程 */ }

    await LocalNotifications.schedule({
      notifications: plans.map((p) => ({
        id: p.id,
        title: p.title,
        body: p.body,
        channelId: classChannelId(),
        schedule: { at: p.at, allowWhileIdle: true },
      })),
    });
  } catch (err) {
    console.warn('syncClassReminders failed:', err);
  }
}
