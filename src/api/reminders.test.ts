import { describe, it, expect, vi } from 'vitest';

// reminders.ts 顶层会 import Capacitor 插件，单测里替换成空壳
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
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

import { reminderTimeFor } from './reminders';
import type { Todo } from '../types';

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
