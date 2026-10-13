// © 2026 ADA-Quart & TyTs · 日日新（ITDC）· PolyForm Noncommercial 1.0.0 · github.com/ADA-quart/ITDC

import { describe, it, expect, vi } from 'vitest';

// reminders.ts 顶层会 import Capacitor 插件，单测里替换成空壳
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false), getPlatform: vi.fn(() => 'web') },
}));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    schedule: vi.fn(),
    cancel: vi.fn(),
    getPending: vi.fn(async () => ({ notifications: [] })),
    createChannel: vi.fn(),
    checkPermissions: vi.fn(async () => ({ display: 'granted' })),
    requestPermissions: vi.fn(async () => ({ display: 'granted' })),
  },
}));
vi.mock('../capacitor/itdc-widget', () => ({
  ITDCWidgetPlugin: { scheduleNotificationDismisses: vi.fn(async () => {}) },
}));

// 提醒的开关/提前量/自动消失都存在 localStorage：node 测试环境没有它，
// 这里放一个内存版（读不到 key = 走各默认值，和生产首次启动一致）
const __store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => (__store.has(k) ? __store.get(k)! : null),
  setItem: (k: string, v: string) => { __store.set(k, String(v)); },
  removeItem: (k: string) => { __store.delete(k); },
});

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { ITDCWidgetPlugin } from '../capacitor/itdc-widget';
import { reminderTimeFor, syncClassReminders } from './reminders';
import { CLASS_NOTIFICATION_ID_BASE } from './class-reminders';
import type { Todo } from '../types';
import type { CalendarEvent } from '../types';

const MIN = 60_000;

function makeTodo(patch: Partial<Todo>): Todo {
  return {
    id: 1,
    title: 'T',
    description: null,
    estimated_minutes: 30,
    priority: 'normal',
    urgency: 1,
    importance: 1,
    deadline: null,
    status: 'pending',
    scheduled_start: null,
    scheduled_end: null,
    color: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    ...patch,
  } as Todo;
}

describe('reminderTimeFor（待办提醒提前量）', () => {
  it('默认到点提醒', () => {
    const start = new Date(Date.now() + 2 * 3600_000);
    const todo = makeTodo({ scheduled_start: start.toISOString() });
    expect(reminderTimeFor(todo, 0)?.toISOString()).toBe(start.toISOString());
  });

  it('提前 N 分钟：在开始时间前 N 分钟触发', () => {
    const start = new Date(Date.now() + 2 * 3600_000);
    const todo = makeTodo({ scheduled_start: start.toISOString() });
    expect(reminderTimeFor(todo, 15)?.toISOString()).toBe(new Date(start.getTime() - 15 * MIN).toISOString());
  });

  it('优先排程开始时间，没有排程时才用截止时间', () => {
    const deadline = new Date(Date.now() + 3 * 3600_000);
    expect(reminderTimeFor(makeTodo({ deadline: deadline.toISOString() }), 10)?.toISOString())
      .toBe(new Date(deadline.getTime() - 10 * MIN).toISOString());

    const start = new Date(Date.now() + 3600_000);
    const both = makeTodo({ scheduled_start: start.toISOString(), deadline: deadline.toISOString() });
    expect(reminderTimeFor(both, 10)?.toISOString()).toBe(new Date(start.getTime() - 10 * MIN).toISOString());
  });

  it('提前量把提醒推到过去（5 分钟后开始、提前 10 分钟）→ 不排提醒', () => {
    const soon = makeTodo({ scheduled_start: new Date(Date.now() + 5 * MIN).toISOString() });
    expect(reminderTimeFor(soon, 10)).toBeNull();
  });
});

describe('syncClassReminders（提醒自动消失）', () => {
  it('按设置给每条上课提醒挂「到点消失」的闹钟', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
    try {
      const start = new Date(Date.now() + 20 * 3600_000);
      const event: CalendarEvent = {
        id: 101,
        calendar_id: 1,
        title: '电法勘探原理与方法',
        description: '王小明\n第3-5周\n03-04节',
        start_time: start.toISOString(),
        end_time: new Date(start.getTime() + 90 * MIN).toISOString(),
        rrule: null,
        location: '东区教学楼A101',
        source: 'cdut',
        uid: null,
        created_at: new Date().toISOString(),
      };
      await syncClassReminders([event]);

      expect(LocalNotifications.schedule).toHaveBeenCalledTimes(1);
      expect(ITDCWidgetPlugin.scheduleNotificationDismisses).toHaveBeenCalledTimes(1);
      const arg = vi.mocked(ITDCWidgetPlugin.scheduleNotificationDismisses).mock.calls[0][0];
      // 默认提前 10 分钟提醒、默认 30 分钟后自动消失（无 localStorage 环境走默认值）
      expect(arg.items).toEqual([
        { id: CLASS_NOTIFICATION_ID_BASE + 101, at: start.getTime() - 10 * MIN + 30 * MIN },
      ]);
    } finally {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
      vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    }
  });
});
