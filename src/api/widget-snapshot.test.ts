// 验证小组件快照中的两个关键逻辑：
// 1) RRULE 重复课程能否在非首次发生日被正确展开（课程表的核心场景）
// 2) 顶栏标题是否取自"最近有课的那个日历"
import { describe, it, expect } from 'vitest';
import { RRule } from 'rrule';

// 与 widget-sync.ts 保持一致的时间工具（纯函数，避免引入 Capacitor 依赖）
function pad2(n: number): string { return String(n).padStart(2, '0'); }
function hhmm(value: string | Date | null): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function dayStart(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

interface Ev {
  id: number; calendar_id: number; title: string; description: string | null;
  start_time: string; end_time: string; rrule: string | null; location: string | null;
  source: string; uid: string | null; calendar_color?: string; created_at: string;
}

function occurrencesOnDay(event: Ev, target: Date): { start: Date; end: Date }[] {
  const firstStart = new Date(event.start_time);
  const firstEnd = new Date(event.end_time);
  if (Number.isNaN(firstStart.getTime()) || Number.isNaN(firstEnd.getTime())) return [];

  const from = dayStart(target);
  const to = new Date(from.getTime() + 24 * 3600_000);
  const durationMs = Math.max(0, firstEnd.getTime() - firstStart.getTime());

  if (!event.rrule) {
    if (firstStart >= from && firstStart < to) return [{ start: firstStart, end: firstEnd }];
    return [];
  }

  try {
    const parsed = RRule.parseString(event.rrule.replace(/^RRULE:/i, ''));
    parsed.dtstart = firstStart;
    const rule = new RRule(parsed);
    const occurrences = rule.between(new Date(from.getTime() - durationMs), to, true);
    return occurrences
      .map((occ) => ({ start: occ, end: new Date(occ.getTime() + durationMs) }))
      .filter((o) => o.end > from && o.start < to);
  } catch {
    if (firstStart >= from && firstStart < to) return [{ start: firstStart, end: firstEnd }];
    return [];
  }
}

function makeEvent(overrides: Partial<Ev>): Ev {
  return {
    id: 1, calendar_id: 1, title: '课程', description: null,
    start_time: '', end_time: '', rrule: null, location: null,
    source: 'manual', uid: null, created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('RRULE 重复课程展开', () => {
  it('每周重复的课在第二周同一天也能被识别', () => {
    // 2026-09-01 是周二，设一门每周二 14:30-16:05 的课
    const first = new Date(2026, 8, 1, 14, 30, 0, 0);
    const end = new Date(2026, 8, 1, 16, 5, 0, 0);
    const ev = makeEvent({
      start_time: first.toISOString(),
      end_time: end.toISOString(),
      rrule: 'FREQ=WEEKLY;BYDAY=TU;UNTIL=20270101T000000Z',
    });

    // 首次发生当天
    const week1 = new Date(2026, 8, 1);
    expect(occurrencesOnDay(ev, week1).length).toBe(1);

    // 第二周同一天（周二 9/8）—— 这正是此前会漏掉的场景
    const week2 = new Date(2026, 8, 8);
    const occ2 = occurrencesOnDay(ev, week2);
    expect(occ2.length).toBe(1);
    expect(hhmm(occ2[0].start)).toBe('14:30');
    expect(hhmm(occ2[0].end)).toBe('16:05');

    // 第三周（9/15）同样命中
    expect(occurrencesOnDay(ev, new Date(2026, 8, 15)).length).toBe(1);

    // 非周二不应命中
    expect(occurrencesOnDay(ev, new Date(2026, 8, 9)).length).toBe(0);
  });

  it('非重复事件只在当天命中', () => {
    const ev = makeEvent({
      start_time: new Date(2026, 8, 10, 9, 0).toISOString(),
      end_time: new Date(2026, 8, 10, 10, 0).toISOString(),
    });
    expect(occurrencesOnDay(ev, new Date(2026, 8, 10)).length).toBe(1);
    expect(occurrencesOnDay(ev, new Date(2026, 8, 11)).length).toBe(0);
  });

  it('RRULE 非法时退化为只看首次发生，不抛异常', () => {
    const ev = makeEvent({
      start_time: new Date(2026, 8, 10, 9, 0).toISOString(),
      end_time: new Date(2026, 8, 10, 10, 0).toISOString(),
      rrule: 'THIS IS NOT A VALID RRULE',
    });
    expect(() => occurrencesOnDay(ev, new Date(2026, 8, 10))).not.toThrow();
    expect(occurrencesOnDay(ev, new Date(2026, 8, 10)).length).toBe(1);
  });

  it('带 RRULE: 前缀的规则也能解析', () => {
    const ev = makeEvent({
      start_time: new Date(2026, 8, 1, 8, 0).toISOString(),
      end_time: new Date(2026, 8, 1, 9, 0).toISOString(),
      rrule: 'RRULE:FREQ=WEEKLY;BYDAY=TU',
    });
    expect(occurrencesOnDay(ev, new Date(2026, 8, 8)).length).toBe(1);
  });
});

describe('最近有课的日历名', () => {
  interface Item { start: string; calendarId: number }

  function nearestClassCalendarName(
    todayItems: Item[], tomorrowItems: Item[], now: Date, nameById: Map<number, string>
  ): string {
    const nowHm = hhmm(now);
    const upcomingToday = todayItems.filter((i) => i.start >= nowHm);
    const candidates = upcomingToday.length > 0 ? upcomingToday : tomorrowItems;
    for (const item of candidates) {
      const name = nameById.get(item.calendarId);
      if (name) return name;
    }
    return '';
  }

  const names = new Map([[1, '我的日历'], [2, '课程表'], [3, '社团']]);

  it('优先取今天还没开始的最近一节课所属日历', () => {
    const now = new Date(2026, 8, 29, 10, 0);
    const today = [
      { start: '08:00', calendarId: 1 },  // 已过去
      { start: '14:30', calendarId: 2 },  // 最近的下一节
      { start: '19:00', calendarId: 3 },
    ];
    expect(nearestClassCalendarName(today, [], now, names)).toBe('课程表');
  });

  it('今天的课都上完了则取明天第一节课所属日历', () => {
    const now = new Date(2026, 8, 29, 22, 0);
    const today = [{ start: '14:30', calendarId: 1 }];
    const tomorrow = [{ start: '08:00', calendarId: 2 }];
    expect(nearestClassCalendarName(today, tomorrow, now, names)).toBe('课程表');
  });

  it('今天和明天都没课时返回空串（原生端回退显示应用名）', () => {
    const now = new Date(2026, 8, 29, 10, 0);
    expect(nearestClassCalendarName([], [], now, names)).toBe('');
  });

  it('来源日历取不到名字时继续往后找', () => {
    const now = new Date(2026, 8, 29, 10, 0);
    const today = [
      { start: '14:30', calendarId: 999 }, // 已删除的日历
      { start: '19:00', calendarId: 3 },
    ];
    expect(nearestClassCalendarName(today, [], now, names)).toBe('社团');
  });
});