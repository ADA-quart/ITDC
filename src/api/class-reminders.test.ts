import { describe, it, expect } from 'vitest';
import type { CalendarEvent } from '../types';
import {
  CLASS_NOTIFICATION_ID_BASE,
  isClassEvent,
  planClassReminders,
} from './class-reminders';

/** 本地时间 HH:mm（与实现保持同一口径，避免测试依赖运行时时区） */
function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function makeEvent(overrides?: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 101,
    calendar_id: 1,
    title: '电法勘探原理与方法',
    description: '王小明\n第3-5,7-16周\n03-04节',
    start_time: '2026-10-08T08:10:00+08:00',
    end_time: '2026-10-08T09:45:00+08:00',
    rrule: null,
    location: '东区教学楼A101',
    source: 'cdut',
    uid: null,
    created_at: '2026-10-01T00:00:00+08:00',
    ...overrides,
  };
}

const NOW = new Date('2026-10-07T12:00:00+08:00').getTime();

describe('isClassEvent', () => {
  it('识别教务课表导入的事件', () => {
    expect(isClassEvent(makeEvent())).toBe(true);
  });

  it('普通事件与未知来源不算课表事件', () => {
    expect(isClassEvent(makeEvent({ source: '' }))).toBe(false);
    expect(isClassEvent(makeEvent({ source: 'custom' }))).toBe(false);
  });
});

describe('planClassReminders', () => {
  it('为课表事件生成带课程名/时间/教室/教师的提醒', () => {
    const plans = planClassReminders([makeEvent()], NOW, 10);
    expect(plans).toHaveLength(1);
    const start = new Date('2026-10-08T08:10:00+08:00');
    expect(plans[0].title).toBe('电法勘探原理与方法');
    expect(plans[0].body).toBe(`${hhmm(start)} 上课 · 东区教学楼A101 · 王小明`);
    // 提前 10 分钟
    expect(plans[0].at.getTime()).toBe(start.getTime() - 10 * 60_000);
    // id 落在上课提醒命名空间，不与待办 id 冲突
    expect(plans[0].id).toBe(CLASS_NOTIFICATION_ID_BASE + 101);
  });

  it('跳过非课表事件与重复事件', () => {
    const plans = planClassReminders([
      makeEvent({ id: 1, source: '' }),
      makeEvent({ id: 2, rrule: 'FREQ=WEEKLY' }),
      makeEvent({ id: 3 }),
    ], NOW, 10);
    expect(plans.map((p) => p.id)).toEqual([CLASS_NOTIFICATION_ID_BASE + 3]);
  });

  it('跳过已过期和来不及提醒的事件', () => {
    const plans = planClassReminders([
      makeEvent({ id: 1, start_time: '2026-10-06T08:10:00+08:00' }),
      makeEvent({ id: 2, start_time: '2026-10-07T12:05:00+08:00' }), // 5 分钟后，提前 10 分钟已来不及
    ], NOW, 10);
    expect(plans).toHaveLength(0);
  });

  it('跳过 90 天以外的课程', () => {
    const plans = planClassReminders([
      makeEvent({ id: 1, start_time: '2027-06-01T08:10:00+08:00' }),
    ], NOW, 10);
    expect(plans).toHaveLength(0);
  });

  it('缺少教室/教师时正文仍可读', () => {
    const noRoom = planClassReminders([makeEvent({ location: null })], NOW, 10);
    const start = new Date('2026-10-08T08:10:00+08:00');
    expect(noRoom[0].body).toBe(`${hhmm(start)} 上课 · 王小明`);

    const noTeacher = planClassReminders([makeEvent({ description: '第3-5周\n03-04节', location: '' })], NOW, 10);
    expect(noTeacher[0].body).toBe(`${hhmm(start)} 上课`);
  });

  it('按传入的提前分钟数计算提醒时间', () => {
    const plans = planClassReminders([makeEvent()], NOW, 30);
    const start = new Date('2026-10-08T08:10:00+08:00');
    expect(plans[0].at.getTime()).toBe(start.getTime() - 30 * 60_000);
  });
});
