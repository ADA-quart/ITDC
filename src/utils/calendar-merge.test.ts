import { describe, it, expect } from 'vitest';
import { findMergeTarget, isFullyInside } from './calendar-merge';

const at = (h: number, m = 0) => new Date(2026, 9, 12, h, m, 0, 0);
const course = { id: 'c1', title: '电法勘探', start: at(10, 15), end: at(11, 50) };

describe('isFullyInside', () => {
  it('待办整段落在课程里 → 融合', () => {
    expect(isFullyInside({ start: at(10, 30), end: at(11, 10) }, course)).toBe(true);
  });

  it('只是部分重叠不算融合（比如跨到下一节课）', () => {
    expect(isFullyInside({ start: at(11, 30), end: at(12, 30) }, course)).toBe(false);
  });

  it('完全在课程之外不算融合', () => {
    expect(isFullyInside({ start: at(14), end: at(15) }, course)).toBe(false);
  });

  it('边界对齐也算（含 1 分钟容差）', () => {
    expect(isFullyInside({ start: at(10, 15), end: at(11, 50) }, course)).toBe(true);
    expect(isFullyInside({ start: at(10, 14), end: at(11, 49) }, course)).toBe(true);
  });

  it('时间非法时返回 false', () => {
    expect(isFullyInside({ start: 'x', end: at(11) }, course)).toBe(false);
  });
});

describe('findMergeTarget', () => {
  it('嵌套日程时并入最小的那个容器', () => {
    const outer = { id: 'outer', start: at(8), end: at(18) };
    const inner = { id: 'inner', start: at(10), end: at(12) };
    const target = findMergeTarget({ start: at(10, 30), end: at(11, 30) }, [outer, inner]);
    expect(target?.id).toBe('inner');
  });

  it('没有容器时返回 null（待办自己占一格）', () => {
    expect(findMergeTarget({ start: at(20), end: at(21) }, [course])).toBeNull();
  });
});
