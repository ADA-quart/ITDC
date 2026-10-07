import { describe, it, expect } from 'vitest';
import type { CalendarEvent, Todo } from '../types';
import {
  generateScheduleLocally,
  validateScheduleLocally,
  splitIntoSegments,
  advanceToWorkHours,
  isWithinWorkHours,
  findNextFreeSlot,
} from './local-scheduler';

function makeTodo(overrides?: Partial<Todo>): Todo {
  return {
    id: 1,
    title: 'task',
    description: null,
    estimated_minutes: 60,
    priority: 'normal',
    urgency: 2,
    importance: 2,
    deadline: null,
    status: 'pending',
    scheduled_start: null,
    scheduled_end: null,
    color: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeEvent(overrides?: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 1,
    calendar_id: 1,
    title: 'event',
    description: null,
    start_time: new Date().toISOString(),
    end_time: new Date().toISOString(),
    rrule: null,
    location: null,
    source: 'manual',
    uid: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const at = (dayOffset: number, hour: number, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
};

describe('splitIntoSegments', () => {
  it('splits long durations into capped segments', () => {
    expect(splitIntoSegments(200, 90)).toEqual([90, 90, 20]);
  });

  it('keeps short durations as a single segment', () => {
    expect(splitIntoSegments(45, 90)).toEqual([45]);
  });

  it('avoids tiny remainder segments', () => {
    // 95 分钟拆成 90+5 没有意义：从上一段借 10 分钟，凑成 80+15
    expect(splitIntoSegments(95, 90)).toEqual([80, 15]);
    expect(splitIntoSegments(100, 90)).toEqual([85, 15]);
  });
});

describe('work hours helpers', () => {
  it('treats 7:00-23:00 as within work hours', () => {
    expect(isWithinWorkHours(at(1, 7))).toBe(true);
    expect(isWithinWorkHours(at(1, 22))).toBe(true);
    expect(isWithinWorkHours(at(1, 6))).toBe(false);
    expect(isWithinWorkHours(at(1, 23))).toBe(false);
  });

  it('rolls late night to next morning', () => {
    const next = advanceToWorkHours(at(1, 23, 30));
    expect(next.getHours()).toBe(7);
    expect(next.getDate()).toBe(at(2, 7).getDate());
  });

  it('pulls early morning forward to 7:00 same day', () => {
    const next = advanceToWorkHours(at(1, 5));
    expect(next.getHours()).toBe(7);
    expect(next.getDate()).toBe(at(1, 7).getDate());
  });
});

describe('findNextFreeSlot', () => {
  it('skips a conflicting busy slot', () => {
    const busy = [{ start: at(1, 9).toISOString(), end: at(1, 10).toISOString() }];
    const start = findNextFreeSlot(at(1, 9), 60, busy, null);
    expect(start).not.toBeNull();
    expect(new Date(start!).getTime() >= at(1, 10).getTime()).toBe(true);
  });

  it('returns null when the deadline cannot be met', () => {
    const busy = [{ start: at(1, 7).toISOString(), end: at(1, 22).toISOString() }];
    const result = findNextFreeSlot(at(1, 7), 60, busy, at(1, 23));
    expect(result).toBeNull();
  });
});

describe('generateScheduleLocally', () => {
  // 回归：以前休息的起点取「所有忙碌块里最晚的结束时间」，
  // 日历里只要有远期事件，15 分钟休息就会被丢到几天之后 —— 连干 3 小时也没休息，
  // 还在无关时间点挖了个空洞
  it('places the 2-hour break right after the block that triggered it', () => {
    // 固定"现在"为周一 09:00，保证三段 90 分钟能连在一起排
    const monday9 = at(1, 9);
    const farFutureClass = makeEvent({
      start_time: at(3, 10).toISOString(),
      end_time: at(3, 11).toISOString(),
    });
    const schedule = generateScheduleLocally(
      [
        makeTodo({ id: 1, estimated_minutes: 90 }),
        makeTodo({ id: 2, estimated_minutes: 90 }),
        makeTodo({ id: 3, estimated_minutes: 90 }),
      ],
      [farFutureClass],
      { now: monday9 }
    );
    expect(schedule).toHaveLength(3);
    const secondEnd = new Date(schedule[1].end).getTime();
    const thirdStart = new Date(schedule[2].start).getTime();
    // 前两段排满 2 小时后必须先休息 15 分钟，第三段才能开始
    expect(thirdStart - secondEnd).toBe(15 * 60 * 1000);
    // 而且这个休息不该跑到远期课程那边去
    expect(thirdStart - monday9.getTime()).toBeLessThan(4 * 60 * 60 * 1000);
  });

  it('schedules pending todos inside work hours', () => {
    const schedule = generateScheduleLocally([makeTodo({ estimated_minutes: 60 })], []);
    expect(schedule.length).toBe(1);
    const start = new Date(schedule[0].start);
    const end = new Date(schedule[0].end);
    expect(start.getHours()).toBeGreaterThanOrEqual(7);
    expect(end.getHours()).toBeLessThanOrEqual(23);
  });

  it('ignores todos that are not pending', () => {
    const schedule = generateScheduleLocally(
      [makeTodo({ status: 'done' }), makeTodo({ id: 2, status: 'scheduled' })],
      []
    );
    expect(schedule).toEqual([]);
  });

  it('avoids overlapping existing events', () => {
    // 占用「现在 → 明天 12:00」整段，首个可用时段必须落在明天 12:00 之后
    const events = [
      makeEvent({ start_time: new Date().toISOString(), end_time: at(1, 12).toISOString() }),
    ];
    const schedule = generateScheduleLocally([makeTodo({ estimated_minutes: 60 })], events);
    expect(schedule.length).toBe(1);
    const start = new Date(schedule[0].start);
    expect(start >= at(1, 12)).toBe(true);
  });

  it('orders P1 before P4', () => {
    const todos = [
      makeTodo({ id: 1, title: 'p4', priority: 'normal' }),
      makeTodo({ id: 2, title: 'p1', priority: 'urgent-important' }),
    ];
    const schedule = generateScheduleLocally(todos, []);
    expect(schedule[0].title).toBe('p1');
  });

  it('allows can_do_in_class todos to be placed inside a class block', () => {
    const classEvent = makeEvent({
      id: 99,
      title: '水课',
      source: 'cdut',
      start_time: at(1, 8).toISOString(),
      end_time: at(1, 12).toISOString(),
    });
    const schedule = generateScheduleLocally(
      [makeTodo({ id: 1, estimated_minutes: 45, can_do_in_class: true })],
      [classEvent],
      { now: at(1, 10) }
    );
    expect(schedule).toHaveLength(1);
    const start = new Date(schedule[0].start);
    const end = new Date(schedule[0].end);
    // 整段落在课程内，之后会被日历融合进这节课
    expect(start >= at(1, 8) && end <= at(1, 12)).toBe(true);
  });

  it('keeps normal todos out of class blocks', () => {
    const classEvent = makeEvent({
      id: 99,
      title: '专业课',
      source: 'cdut',
      start_time: at(1, 8).toISOString(),
      end_time: at(1, 12).toISOString(),
    });
    const schedule = generateScheduleLocally(
      [makeTodo({ estimated_minutes: 45 })],
      [classEvent],
      { now: at(1, 10) }
    );
    expect(schedule).toHaveLength(1);
    expect(new Date(schedule[0].start) >= at(1, 12)).toBe(true);
  });

  it('labels split segments with (i/N)', () => {
    const schedule = generateScheduleLocally([makeTodo({ estimated_minutes: 200 })], []);
    expect(schedule.length).toBeGreaterThan(1);
    expect(schedule[0].title).toContain('(1/');
    expect(schedule[1].title).toContain('(2/');
  });

  it('produces a self-consistent schedule that passes local validation', () => {
    const todos = [
      makeTodo({ id: 1, estimated_minutes: 90 }),
      makeTodo({ id: 2, estimated_minutes: 45, priority: 'important' }),
    ];
    const schedule = generateScheduleLocally(todos, []);
    const validation = validateScheduleLocally(schedule, todos);
    expect(validation.errors.filter(e => e.startsWith('时间冲突'))).toEqual([]);
  });
});

describe('validateScheduleLocally', () => {
  it('flags overlapping items', () => {
    const items = [
      { todo_id: 1, title: 'a', start: at(1, 9).toISOString(), end: at(1, 11).toISOString(), priority: 'normal' as const },
      { todo_id: 2, title: 'b', start: at(1, 10).toISOString(), end: at(1, 12).toISOString(), priority: 'normal' as const },
    ];
    const result = validateScheduleLocally(items, []);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.startsWith('时间冲突'))).toBe(true);
  });

  it('flags items outside work hours', () => {
    const items = [
      { todo_id: 1, title: 'a', start: at(1, 5).toISOString(), end: at(1, 6).toISOString(), priority: 'normal' as const },
    ];
    const result = validateScheduleLocally(items, []);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.startsWith('超出工作时段'))).toBe(true);
  });

  it('passes a clean schedule', () => {
    const items = [
      { todo_id: 1, title: 'a', start: at(1, 9).toISOString(), end: at(1, 10).toISOString(), priority: 'normal' as const },
    ];
    expect(validateScheduleLocally(items, []).valid).toBe(true);
  });

  it('allows a contained in-class segment only when the todo is marked', () => {
    const event = makeEvent({
      id: 99,
      source: 'cdut',
      start_time: at(1, 8).toISOString(),
      end_time: at(1, 10).toISOString(),
    });
    const item = {
      todo_id: 1,
      title: '课上整理笔记',
      start: at(1, 8, 30).toISOString(),
      end: at(1, 9, 15).toISOString(),
      priority: 'normal' as const,
    };
    const allowed = validateScheduleLocally(
      [item],
      [makeTodo({ id: 1, estimated_minutes: 45, can_do_in_class: true })],
      [event]
    );
    expect(allowed.errors.filter(e => e.startsWith('与已有事件冲突'))).toEqual([]);

    const denied = validateScheduleLocally(
      [item],
      [makeTodo({ id: 1, estimated_minutes: 45 })],
      [event]
    );
    expect(denied.errors.some(e => e.startsWith('与已有事件冲突'))).toBe(true);
  });

  it('flags a partial split that does not cover the estimate', () => {
    const items = [
      {
        todo_id: 1,
        title: 'a',
        start: at(1, 9).toISOString(),
        end: at(1, 9, 30).toISOString(),
        priority: 'normal' as const,
      },
    ];
    const result = validateScheduleLocally(items, [makeTodo({ id: 1, estimated_minutes: 90 })]);
    expect(result.errors.some(e => e.startsWith('拆分不完整'))).toBe(true);
  });

  it('flags pending todos that were not scheduled at all', () => {
    const result = validateScheduleLocally([], [makeTodo({ id: 7, title: '被漏掉的任务' })]);
    expect(result.errors.some(e => e.startsWith('未能安排'))).toBe(true);
  });
});
