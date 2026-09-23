import { describe, it, expect } from 'vitest';
import { findNextFreeSlot, splitIntoSegments, isWithinWorkHours, advanceToWorkHours } from './scheduler.ts';

// 构造本地时间（无时区后缀）的字符串，保证 new Date() 解析为本地时间
function localISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${dd}T${h}:${mi}:00`;
}

describe('splitIntoSegments', () => {
  it('returns a single segment when total is within max', () => {
    expect(splitIntoSegments(90, 90)).toEqual([90]);
  });
  it('splits into full-length segments exactly', () => {
    expect(splitIntoSegments(180, 90)).toEqual([90, 90]);
  });
  it('keeps the remainder as a final partial segment', () => {
    expect(splitIntoSegments(200, 90)).toEqual([90, 90, 20]);
  });
  it('returns single segment for small totals', () => {
    expect(splitIntoSegments(45, 90)).toEqual([45]);
  });
  it('splits into multiple full segments', () => {
    expect(splitIntoSegments(360, 90)).toEqual([90, 90, 90, 90]);
  });
});

describe('isWithinWorkHours', () => {
  it('returns true for a time within work hours', () => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    expect(isWithinWorkHours(d)).toBe(true);
  });
  it('returns false just before work start (6:59)', () => {
    const d = new Date();
    d.setHours(6, 59, 0, 0);
    expect(isWithinWorkHours(d)).toBe(false);
  });
  it('returns true at the exact work start (7:00)', () => {
    const d = new Date();
    d.setHours(7, 0, 0, 0);
    expect(isWithinWorkHours(d)).toBe(true);
  });
  it('returns false at the exact work end (23:00)', () => {
    const d = new Date();
    d.setHours(23, 0, 0, 0);
    expect(isWithinWorkHours(d)).toBe(false);
  });
});

describe('advanceToWorkHours', () => {
  it('moves an early time to 7:00 on the same day', () => {
    const d = new Date(2024, 0, 5, 5, 30);
    const r = advanceToWorkHours(d);
    expect(r.getHours()).toBe(7);
    expect(r.getDate()).toBe(5);
  });
  it('moves a late time to 7:00 on the next day', () => {
    const d = new Date(2024, 0, 5, 23, 30);
    const r = advanceToWorkHours(d);
    expect(r.getHours()).toBe(7);
    expect(r.getDate()).toBe(6);
  });
  it('leaves a time already within work hours unchanged', () => {
    const d = new Date(2024, 0, 5, 10, 30);
    const r = advanceToWorkHours(d);
    expect(r.getHours()).toBe(10);
    expect(r.getMinutes()).toBe(30);
    expect(r.getDate()).toBe(5);
  });
});

describe('findNextFreeSlot', () => {
  it('returns the start time when there is no conflict and it fits in work hours', () => {
    const start = new Date(2024, 0, 5, 9, 0);
    const r = findNextFreeSlot(start, 60, [], null);
    expect(r).not.toBeNull();
    expect(new Date(r!).getHours()).toBe(9);
    expect(new Date(r!).getDate()).toBe(5);
  });

  it('skips over a conflicting busy slot', () => {
    const start = new Date(2024, 0, 5, 9, 0);
    const busy = [{ start: localISO(new Date(2024, 0, 5, 9, 0)), end: localISO(new Date(2024, 0, 5, 10, 30)) }];
    const r = findNextFreeSlot(start, 60, busy, null);
    expect(r).not.toBeNull();
    // conflict ends at 10:30, so slot should start at 10:30
    expect(new Date(r!).getHours()).toBe(10);
    expect(new Date(r!).getMinutes()).toBe(30);
    expect(new Date(r!).getDate()).toBe(5);
  });

  it('returns null when the requested duration would exceed the deadline', () => {
    const start = new Date(2024, 0, 5, 9, 0);
    const deadline = new Date(2024, 0, 5, 10, 0); // only 60 minutes available
    const r = findNextFreeSlot(start, 90, [], deadline);
    expect(r).toBeNull();
  });

  it('returns the start time when the duration fits before the deadline', () => {
    const start = new Date(2024, 0, 5, 9, 0);
    const deadline = new Date(2024, 0, 5, 11, 0);
    const r = findNextFreeSlot(start, 60, [], deadline);
    expect(r).not.toBeNull();
    expect(new Date(r!).getHours()).toBe(9);
  });

  it('pushes a late start to the next working day', () => {
    const start = new Date(2024, 0, 5, 23, 30);
    const r = findNextFreeSlot(start, 60, [], null);
    expect(r).not.toBeNull();
    expect(new Date(r!).getHours()).toBe(7);
    expect(new Date(r!).getDate()).toBe(6);
  });

  it('pushes to the next day when the slot would end after work hours', () => {
    const start = new Date(2024, 0, 5, 22, 30);
    const r = findNextFreeSlot(start, 60, [], null);
    expect(r).not.toBeNull();
    expect(new Date(r!).getDate()).toBe(6);
    expect(new Date(r!).getHours()).toBe(7);
  });
});
