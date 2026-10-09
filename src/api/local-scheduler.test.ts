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
  it('treats 8:00-22:00 as within work hours', () => {
    expect(isWithinWorkHours(at(1, 8))).toBe(true);
    expect(isWithinWorkHours(at(1, 7))).toBe(false);
    expect(isWithinWorkHours(at(1, 21))).toBe(true);
    expect(isWithinWorkHours(at(1, 22))).toBe(false);
    expect(isWithinWorkHours(at(1, 6))).toBe(false);
    expect(isWithinWorkHours(at(1, 23))).toBe(false);
  });

  it('rolls late night to next morning', () => {
    const next = advanceToWorkHours(at(1, 23, 30));
    expect(next.getHours()).toBe(8);
    expect(next.getDate()).toBe(at(2, 8).getDate());
  });

  it('pulls early morning forward to 8:00 same day', () => {
    const next = advanceToWorkHours(at(1, 5));
    expect(next.getHours()).toBe(8);
    expect(next.getDate()).toBe(at(1, 8).getDate());
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
    // 固定"现在"为周一 13:00：避开午餐与晚餐保护时段，三段 90 分钟能连排
    const monday13 = at(1, 13);
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
      { now: monday13 }
    );
    expect(schedule).toHaveLength(3);
    const secondEnd = new Date(schedule[1].end).getTime();
    const thirdStart = new Date(schedule[2].start).getTime();
    // 前两段排满 2 小时后必须先休息 15 分钟，第三段才能开始
    expect(thirdStart - secondEnd).toBe(15 * 60 * 1000);
    // 而且这个休息不该跑到远期课程那边去
    expect(thirdStart - monday13.getTime()).toBeLessThan(4 * 60 * 60 * 1000);
  });

  it('schedules pending todos inside work hours', () => {
    const schedule = generateScheduleLocally([makeTodo({ estimated_minutes: 60 })], []);
    expect(schedule.length).toBe(1);
    const start = new Date(schedule[0].start);
    const end = new Date(schedule[0].end);
    expect(start.getHours()).toBeGreaterThanOrEqual(8);
    expect(end.getHours()).toBeLessThanOrEqual(22);
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

  it('does not double-book two in-class todos inside the same class', () => {
    const classEvent = makeEvent({
      id: 99,
      title: '水课',
      source: 'cdut',
      start_time: at(1, 14, 30).toISOString(),
      end_time: at(1, 16, 30).toISOString(),
    });
    const schedule = generateScheduleLocally(
      [
        makeTodo({ id: 1, title: 'A', estimated_minutes: 45, can_do_in_class: true }),
        makeTodo({ id: 2, title: 'B', estimated_minutes: 45, can_do_in_class: true }),
      ],
      [classEvent],
      { now: at(1, 15) }
    );
    expect(schedule).toHaveLength(2);
    const [first, second] = [...schedule].sort((a, b) => a.start.localeCompare(b.start));
    // 第二条必须排在第一条结束后，不能因为"两段都在课内"就重叠
    expect(new Date(second.start).getTime() >= new Date(first.end).getTime()).toBe(true);
  });

  it('treats an iCal course with classroom and aligned time as in-class allowed', () => {
    const icalCourse = makeEvent({
      id: 77,
      title: '重磁勘探原理与方法',
      source: 'ical',
      location: 'E1B205',
      start_time: at(1, 14, 30).toISOString(),
      end_time: at(1, 16, 5).toISOString(),
    });
    const schedule = generateScheduleLocally(
      [makeTodo({ id: 1, estimated_minutes: 45, can_do_in_class: true })],
      [icalCourse],
      { now: at(1, 15) }
    );
    expect(schedule).toHaveLength(1);
    const start = new Date(schedule[0].start);
    const end = new Date(schedule[0].end);
    expect(start >= at(1, 14, 30) && end <= at(1, 16, 5)).toBe(true);
  });

  it('skips tiny gaps between classes', () => {
    // 10:00 下课，10:25 上下一节：25 分钟课间不排 15 分钟任务
    const shortGap = [
      makeEvent({ id: 1, source: 'cdut', start_time: at(1, 8).toISOString(), end_time: at(1, 10).toISOString() }),
      makeEvent({ id: 2, source: 'cdut', start_time: at(1, 10, 25).toISOString(), end_time: at(1, 12).toISOString() }),
    ];
    const scheduled = generateScheduleLocally(
      [makeTodo({ estimated_minutes: 15 })],
      shortGap,
      { now: at(1, 10) }
    );
    expect(scheduled).toHaveLength(1);
    expect(new Date(scheduled[0].start) >= at(1, 12)).toBe(true);

    // 5 分钟课间同样跳过
    const fiveMinuteGap = [
      makeEvent({ id: 1, source: 'cdut', start_time: at(1, 8).toISOString(), end_time: at(1, 10).toISOString() }),
      makeEvent({ id: 2, source: 'cdut', start_time: at(1, 10, 5).toISOString(), end_time: at(1, 12).toISOString() }),
    ];
    const scheduled2 = generateScheduleLocally(
      [makeTodo({ estimated_minutes: 15 })],
      fiveMinuteGap,
      { now: at(1, 10) }
    );
    expect(new Date(scheduled2[0].start) >= at(1, 12)).toBe(true);
  });

  it('still uses a gap that is long enough and leaves a buffer', () => {
    // 10:00-11:10 有 70 分钟空档，60 分钟任务可以排，并留出 10 分钟缓冲
    const events = [
      makeEvent({ id: 1, source: 'cdut', start_time: at(1, 8).toISOString(), end_time: at(1, 10).toISOString() }),
      makeEvent({ id: 2, source: 'cdut', start_time: at(1, 11, 10).toISOString(), end_time: at(1, 12).toISOString() }),
    ];
    const scheduled = generateScheduleLocally(
      [makeTodo({ estimated_minutes: 60 })],
      events,
      { now: at(1, 10) }
    );
    expect(scheduled).toHaveLength(1);
    expect(new Date(scheduled[0].start).getHours()).toBe(10);
    expect(new Date(scheduled[0].end).getHours()).toBe(11);
  });

  it('uses a later class window for a second in-class todo', () => {
    const events = [
      makeEvent({ id: 1, source: 'cdut', start_time: at(1, 14, 30).toISOString(), end_time: at(1, 16, 5).toISOString() }),
      makeEvent({ id: 2, source: 'cdut', start_time: at(1, 16, 25).toISOString(), end_time: at(1, 18, 0).toISOString() }),
    ];
    const schedule = generateScheduleLocally(
      [
        makeTodo({ id: 1, title: 'A', estimated_minutes: 45, can_do_in_class: true }),
        makeTodo({ id: 2, title: 'B', estimated_minutes: 45, can_do_in_class: true }),
      ],
      events,
      { now: at(1, 15) }
    );
    expect(schedule).toHaveLength(2);
    const b = schedule.find((s) => s.title === 'B');
    expect(b).toBeTruthy();
    // 第一节课剩余时间不够，B 应该用第二节课（16:25-18:00），而不是跳到 18:00 之后
    expect(new Date(b!.start) >= at(1, 16, 25)).toBe(true);
    expect(new Date(b!.end) <= at(1, 18, 0)).toBe(true);
  });

  it('never schedules during lunch break', () => {
    const events = [
      makeEvent({ id: 1, source: 'cdut', start_time: at(1, 8, 10).toISOString(), end_time: at(1, 11, 50).toISOString() }),
      makeEvent({ id: 2, source: 'cdut', start_time: at(1, 13, 0).toISOString(), end_time: at(1, 14, 0).toISOString() }),
    ];
    const schedule = generateScheduleLocally(
      [makeTodo({ estimated_minutes: 60 })],
      events,
      { now: at(1, 8) }
    );
    expect(schedule).toHaveLength(1);
    const start = new Date(schedule[0].start);
    const end = new Date(schedule[0].end);
    // 11:50-13:00 是午饭，13:00-14:00 有课，只能排到 14:00 之后
    expect(start >= at(1, 14)).toBe(true);
    expect(start < at(1, 13) && end > at(1, 11, 50)).toBe(false);
  });

  it('never schedules during dinner break', () => {
    const events = [
      makeEvent({ id: 1, source: 'cdut', start_time: at(1, 8, 10).toISOString(), end_time: at(1, 11, 50).toISOString() }),
      makeEvent({ id: 2, source: 'cdut', start_time: at(1, 13, 0).toISOString(), end_time: at(1, 16, 5).toISOString() }),
      makeEvent({ id: 3, source: 'cdut', start_time: at(1, 16, 25).toISOString(), end_time: at(1, 18, 0).toISOString() }),
      makeEvent({ id: 4, source: 'cdut', start_time: at(1, 19, 10).toISOString(), end_time: at(1, 20, 45).toISOString() }),
    ];
    const schedule = generateScheduleLocally(
      [makeTodo({ estimated_minutes: 60 })],
      events,
      { now: at(1, 8) }
    );
    expect(schedule).toHaveLength(1);
    // 18:00-19:00 是晚饭，只能排到晚课之后
    expect(new Date(schedule[0].start) >= at(1, 20, 45)).toBe(true);
  });

  it('does not start before 08:00 even when the day is free', () => {
    const schedule = generateScheduleLocally(
      [makeTodo({ estimated_minutes: 60 })],
      [],
      { now: at(1, 5) }
    );
    expect(schedule).toHaveLength(1);
    expect(new Date(schedule[0].start).getHours()).toBe(8);
  });

  it('does not start new work after 21:00', () => {
    const schedule = generateScheduleLocally(
      [makeTodo({ estimated_minutes: 30 })],
      [],
      { now: at(1, 21, 30) }
    );
    expect(schedule).toHaveLength(1);
    const start = new Date(schedule[0].start);
    expect(start.getDate()).toBe(at(2, 8).getDate());
    expect(start.getHours()).toBe(8);
  });

  it('does not schedule after a late class ends at 21:45', () => {
    const lateClass = makeEvent({
      id: 88,
      source: 'cdut',
      start_time: at(1, 19).toISOString(),
      end_time: at(1, 21, 45).toISOString(),
    });
    const schedule = generateScheduleLocally(
      [makeTodo({ estimated_minutes: 60 })],
      [lateClass],
      { now: at(1, 19, 30) }
    );
    expect(schedule).toHaveLength(1);
    const start = new Date(schedule[0].start);
    expect(start.getDate()).toBe(at(2, 8).getDate());
    expect(start.getHours()).toBe(8);
  });

  it('still allows early-evening work before the 21:00 cutoff', () => {
    const ending20 = makeEvent({
      id: 89,
      source: 'cdut',
      start_time: at(1, 18).toISOString(),
      end_time: at(1, 20).toISOString(),
    });
    const schedule = generateScheduleLocally(
      [makeTodo({ estimated_minutes: 30 })],
      [ending20],
      { now: at(1, 20) }
    );
    expect(schedule).toHaveLength(1);
    expect(new Date(schedule[0].start).getHours()).toBe(20);
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

  it('flags a lunch-time schedule', () => {
    const items = [
      {
        todo_id: 1,
        title: '午饭时间的事',
        start: at(1, 12).toISOString(),
        end: at(1, 12, 30).toISOString(),
        priority: 'normal' as const,
      },
    ];
    const result = validateScheduleLocally(items, []);
    expect(result.errors.some(e => e.includes('午餐'))).toBe(true);
  });

  it('flags a late-night start', () => {
    const items = [
      {
        todo_id: 1,
        title: '深夜任务',
        start: at(1, 21, 30).toISOString(),
        end: at(1, 22, 0).toISOString(),
        priority: 'normal' as const,
      },
    ];
    const result = validateScheduleLocally(items, []);
    expect(result.errors.some(e => e.startsWith('安排在深夜时段'))).toBe(true);
  });

  it('紧急重要的 22:00-22:30 不算深夜，普通待办算', () => {
    const urgent = validateScheduleLocally(
      [{ todo_id: 1, title: '紧急收尾', start: at(1, 22, 0).toISOString(), end: at(1, 22, 30).toISOString(), priority: 'urgent-important' as const }],
      [],
    );
    expect(urgent.errors.some(e => e.includes('深夜') || e.includes('超出工作时段'))).toBe(false);

    const normal = validateScheduleLocally(
      [{ todo_id: 1, title: '普通收尾', start: at(1, 22, 0).toISOString(), end: at(1, 22, 30).toISOString(), priority: 'normal' as const }],
      [],
    );
    expect(normal.errors.some(e => e.includes('深夜') || e.includes('超出工作时段'))).toBe(true);
  });

  it('22:00-22:30 只给紧急重要：普通待办顺延到次日，紧急重要可以排进去', () => {
    const at22 = new Date(2026, 9, 12, 22, 0, 0, 0); // 周一 22:00
    const normal = findNextFreeSlot(at22, 30, [], null, false, false);
    expect(normal?.getDate()).toBe(13); // 顺延到次日
    expect(normal?.getHours()).toBe(8); // 次日 08:00

    // 加时窗口 22:00-22:30，扣掉 5 分钟缓冲后最多放 25 分钟
    const urgent = findNextFreeSlot(at22, 20, [], null, false, true);
    expect(urgent?.getDate()).toBe(12);
    expect(urgent?.getHours()).toBe(22);
    expect(urgent?.getMinutes()).toBe(0);

    // 超出窗口（30 分钟排不进带缓冲的 30 分钟窗口）→ 顺延次日
    const tooLong = findNextFreeSlot(at22, 30, [], null, false, true);
    expect(tooLong?.getDate()).toBe(13);

    // 22:30 之后仍然不行（加时窗口有上限）
    const at2235 = new Date(2026, 9, 12, 22, 35, 0, 0);
    const tooLate = findNextFreeSlot(at2235, 30, [], null, false, true);
    expect(tooLate?.getDate()).toBe(13);
  });
});
