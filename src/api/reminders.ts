import { Capacitor } from '@capacitor/core';
import type { Todo } from '../types';
import { PushNotifications } from '@capacitor/push-notifications';

const REMINDER_KEY = 'itdc_reminder_enabled';
// 本地通知最多提前 90 天，超出则不排程（Android 对过远的定时通知行为不一致）
const MAX_AHEAD_MS = 90 * 24 * 3600_000;

export function isAndroid(): boolean {
  try {
    if (Capacitor.isNative) return Capacitor.getPlatform() === 'android';
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

const notificationIdFor = (id: number) => String('todo-') + id;

export async function scheduleTodoReminder(todo: Todo): Promise<void> {
  try {
    if (!isAndroid() || !getReminderEnabled()) return;
    const time = reminderTimeFor(todo);
    if (!time) return;
    await PushNotifications.scheduleNotification({
      id: notificationIdFor(todo.id),
      title: todo.title,
      body: '提醒：' + todo.title,
      trigger: { type: 'TIME', date: time.toISOString() },
    });
  } catch (err) {
    // 通知排程失败不影响主流程（如权限未授予）
    console.warn('scheduleTodoReminder failed:', err);
  }
}

export async function cancelTodoReminder(id: number): Promise<void> {
  try {
    if (!isAndroid()) return;
    await PushNotifications.cancelPendingNotification({ id: notificationIdFor(id) });
  } catch (err) {
    console.warn('cancelTodoReminder failed:', err);
  }
}

// 全量重排：取消所有已排程待办通知，再为符合条件的逐个重新排程。
// 用于 todo 列表重载后统一同步（覆盖创建/更新/删除/拆分/拖拽等所有变更路径）。
export async function syncAllReminders(todos: Todo[]): Promise<void> {
  try {
    if (!isAndroid()) return;
    await PushNotifications.cancelAllPendingNotifications();
    for (const todo of todos) {
      if (getReminderEnabled() && reminderTimeFor(todo)) {
        await scheduleTodoReminder(todo);
      }
    }
  } catch (err) {
    console.warn('syncAllReminders failed:', err);
  }
}
