import { describe, it, expect } from 'vitest';
import { computeWeeklyStats, weekStartOf } from './weekly-stats';
import type { Todo, CalendarEvent } from '../types';

// 固定 now：2026-10-09（周五）——本周一 = 2026-10-05
const NOW = new Date(2026, 9, 9, 15, 0, 0);
const MON = (day: number, h = 12) => new Date(2026, 9, day, h, 0, 0).toISOString();

function todo(partial: Partial<Todo>): Todo {
  return {
    id: Math.random(),
    title: 't',
    status: 'done',
    urgency: 2,
    importance: 2,
    priority: 'normal',
    estimated_minutes: 60,
    created_at: MON(5),
    completed_at: null,
    ...partial,
  } as Todo;
}

function course(day: number, h: number, minutes: number): CalendarEvent {
  return {
    id: Math.random(),
    title: '课程',
    source: 'cdut',
    start_time: MON(day, h),
    end_time: new Date(2026, 9, day, h, minutes).toISOString(),
    location: 'E1B214',
  } as CalendarEvent;
}

describe('weekly-stats', () => {
  it('weekStartOf：周五 → 本周一；周日 → 上周一', () => {
    expect(weekStartOf(new Date(2026, 9, 9)).getDate()).toBe(5); // 周五 10-09 → 10-05
    expect(weekStartOf(new Date(2026, 9, 11)).getDate()).toBe(5); // 周日 10-11 → 10-05
    expect(weekStartOf(new Date(2026, 9, 12)).getDate()).toBe(12); // 下周一 10-12 → 自己
  });

  it('完成数、紧急重要数、投入时长与每日分布', () => {
    const todos = [
      todo({ completed_at: MON(5), priority: 'urgent-important', estimated_minutes: 90 }),
      todo({ completed_at: new Date(2026, 9, 5, 18).toISOString(), estimated_minutes: 30 }),
      todo({ completed_at: new Date(2026, 9, 7, 10).toISOString(), estimated_minutes: 60 }),
      todo({ completed_at: new Date(2026, 9, 11, 23).toISOString(), estimated_minutes: 60 }), // 周日算本周
      todo({ completed_at: new Date(2026, 9, 12, 0, 30).toISOString() }), // 下周一不算
    ];
    const s = computeWeeklyStats(todos, [], NOW);
    expect(s.done).toBe(4);
    expect(s.doneImportant).toBe(1);
    expect(s.doneMinutes).toBe(240);
    expect(s.perDay).toEqual([2, 0, 1, 0, 0, 0, 1]);
  });

  it('上课只统计像课程的事件', () => {
    const events = [
      course(5, 8, 95),
      course(6, 10, 95),
      { id: 999, title: '生日会', source: 'manual', start_time: MON(6, 20), end_time: new Date(2026, 9, 6, 21).toISOString() } as CalendarEvent,
      course(12, 8, 95), // 下周不算
    ];
    const s = computeWeeklyStats([], events, NOW);
    expect(s.lessons.count).toBe(2);
    expect(s.lessons.minutes).toBe(190);
  });

  it('上周对比', () => {
    const todos = [
      todo({ completed_at: new Date(2026, 9, 1).toISOString() }),
      todo({ completed_at: new Date(2026, 9, 3).toISOString() }),
      todo({ completed_at: MON(5) }),
    ];
    const s = computeWeeklyStats(todos, [], NOW);
    expect(s.done).toBe(1);
    expect(s.lastWeekDone).toBe(2);
  });

  it('streak：本周+上周+上上周有完成 → 3；上上上周没有 → 断', () => {
    const todos = [
      todo({ completed_at: MON(6) }), // 本周
      todo({ completed_at: new Date(2026, 9, 1).toISOString() }), // 上周
      todo({ completed_at: new Date(2026, 8, 25).toISOString() }), // 上上周
      todo({ completed_at: new Date(2026, 8, 10).toISOString() }), // 更早但有断档
    ];
    expect(computeWeeklyStats(todos, [], NOW).streakWeeks).toBe(3);
  });

  it('streak：本周还没完成不算断（从上周往前数）', () => {
    const todos = [
      todo({ completed_at: new Date(2026, 9, 1).toISOString() }), // 上周
      todo({ completed_at: new Date(2026, 8, 25).toISOString() }), // 上上周
    ];
    expect(computeWeeklyStats(todos, [], NOW).streakWeeks).toBe(2);
  });

  it('零数据：streak 0、对比 null', () => {
    const s = computeWeeklyStats([], [], NOW);
    expect(s.done).toBe(0);
    expect(s.streakWeeks).toBe(0);
    expect(s.lastWeekDone).toBeNull();
  });

  it('本周逾期：只列本周内过期且未完成的', () => {
    const todos = [
      todo({ status: 'pending', completed_at: null, deadline: new Date(2026, 9, 7, 12).toISOString(), title: '欠账A' }),
      todo({ status: 'done', completed_at: MON(7), deadline: new Date(2026, 9, 7, 12).toISOString(), title: '已做' }),
      todo({ status: 'pending', completed_at: null, deadline: new Date(2026, 9, 1).toISOString(), title: '上周的' }),
      todo({ status: 'pending', completed_at: null, deadline: new Date(2026, 9, 20).toISOString(), title: '未来的' }),
    ];
    const s = computeWeeklyStats(todos, [], NOW);
    expect(s.overdueThisWeek.map((x) => x.title)).toEqual(['欠账A']);
  });

  it('本周补账：完成时间晚于截止的计入（含补上周的账）', () => {
    const todos = [
      // 本周内完成、超了本周的截止
      todo({ status: 'done', completed_at: new Date(2026, 9, 8).toISOString(), deadline: new Date(2026, 9, 6, 12).toISOString() }),
      // 本周内完成、超了上周的截止（补旧账）
      todo({ status: 'done', completed_at: new Date(2026, 9, 7).toISOString(), deadline: new Date(2026, 9, 1).toISOString() }),
      // 按时完成的不算
      todo({ status: 'done', completed_at: new Date(2026, 9, 6).toISOString(), deadline: new Date(2026, 9, 8).toISOString() }),
    ];
    expect(computeWeeklyStats(todos, [], NOW).caughtUpThisWeek).toBe(2);
  });
});
