import { describe, it, expect } from 'vitest';
import {
  getPriorityFromUrgencyImportance,
  getQuadrantLabel,
  getDeadlineCountdown,
} from './priority.ts';

describe('getPriorityFromUrgencyImportance', () => {
  it.each([
    [3, 3, 'urgent-important'],
    [4, 2, 'urgent'],
    [2, 4, 'important'],
    [3, 1, 'urgent'],
    [4, 0, 'urgent'],
    [1, 2, 'normal'],
    [0, 0, 'normal'],
    [2, 2, 'normal'],
    [4, 4, 'urgent-important'],
  ])(
    'urgency=%d importance=%d -> %s',
    (_urgency: number, _importance: number, expected: string) => {
      expect(
        getPriorityFromUrgencyImportance(_urgency, _importance),
      ).toBe(expected);
    },
  );

  it('boundary: urgency=3 importance=2 is urgent (not important)', () => {
    expect(getPriorityFromUrgencyImportance(3, 2)).toBe('urgent');
  });

  it('boundary: urgency=2 importance=3 is important (not urgent-important)', () => {
    expect(getPriorityFromUrgencyImportance(2, 3)).toBe('important');
  });
});

describe('getQuadrantLabel', () => {
  it.each([
    [3, 3, 'P1 紧急重要'],
    [2, 4, 'P2 重要不紧急'],
    [4, 2, 'P3 紧急不重要'],
    [1, 1, 'P4 普通'],
  ])(
    'urgency=%d importance=%d -> %s',
    (_urgency: number, _importance: number, expected: string) => {
      expect(getQuadrantLabel(_urgency, _importance)).toBe(expected);
    },
  );
});

describe('getDeadlineCountdown', () => {
  const t = {
    noDeadline: 'no deadline',
    expired: 'expired',
    remainingHours: 'in {n}h',
    remainingDays: 'in {n}d',
  };

  // 以当前时刻为基准构造相对日期；offset 足够大以避免测试执行期间跨越边界
  const now = Date.now();
  const at = (hoursFromNow: number) =>
    new Date(now + hoursFromNow * 3600_000).toISOString();

  it('returns noDeadline message when deadline is null', () => {
    expect(getDeadlineCountdown(null, t)).toBe('no deadline');
  });

  it.each([1, 86400 / 3600]) (
    'returns expired message when deadline is in the past ({n}h ago)',
    (_hoursAgo: number) => {
      expect(getDeadlineCountdown(at(-_hoursAgo), t)).toBe('expired');
    },
  );

  it.each([1, 23]) (
    'returns hours message when deadline is within 24h ({n}h away)',
    (_hoursAway: number) => {
      const n = Math.max(0, _hoursAway - 1);
      expect(getDeadlineCountdown(at(_hoursAway), t)).toBe('in ' + n + 'h');
    },
  );

  it.each([
    [25, 1],
    [48 - 0.5, 1],
    [7 * 24 - 0.5, 6],
  ]) (
    'returns days message when deadline is beyond 24h ({n}d away)',
    (_hoursAway: number, _days: number) => {
      expect(getDeadlineCountdown(at(_hoursAway), t)).toBe('in ' + _days + 'd');
    },
  );
});
