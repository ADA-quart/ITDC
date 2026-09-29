// 验证小组件的两处新逻辑：
// 1) 上过的课自动从"今天"栏消失（按结束时间过滤）
// 2) 待办完成状态：快照基准 + 桌面本地改动的叠加，以及已完成排到末尾
import { describe, it, expect } from 'vitest';

// ---------- 课程过滤（与 ITDCWidgetListService.parseSchedule 同逻辑）----------
interface Item { title: string; start: string; end: string }

function filterToday(items: Item[], nowHm: string): Item[] {
  return items.filter((i) => {
    // 跨天进行中（end 为空）保留；已结束的移除
    if (!i.end) return true;
    return i.end > nowHm;
  });
}

describe('上过的课自动消失', () => {
  const items: Item[] = [
    { title: '早课', start: '08:00', end: '09:35' },
    { title: '上午课', start: '10:00', end: '11:35' },
    { title: '下午课', start: '14:30', end: '16:05' },
    { title: '晚课', start: '19:00', end: '20:35' },
  ];

  it('上午 10:30：8 点的课已消失，其余保留', () => {
    const visible = filterToday(items, '10:30');
    expect(visible.map((i) => i.title)).toEqual(['上午课', '下午课', '晚课']);
  });

  it('中午 12:00：上午两节都已消失', () => {
    const visible = filterToday(items, '12:00');
    expect(visible.map((i) => i.title)).toEqual(['下午课', '晚课']);
  });

  it('晚间 21:00：今天全部上完，列表为空', () => {
    expect(filterToday(items, '21:00')).toEqual([]);
  });

  it('课程正在上（14:30-16:05，当前 15:00）仍然显示', () => {
    const visible = filterToday(items, '15:00');
    expect(visible.map((i) => i.title)).toContain('下午课');
  });

  it('刚好在下课时刻（16:05）即消失', () => {
    const visible = filterToday(items, '16:05');
    expect(visible.map((i) => i.title)).not.toContain('下午课');
  });

  it('跨天进行中（end 为空）不被过滤', () => {
    const overnight: Item[] = [{ title: '跨天事件', start: '23:00', end: '' }];
    expect(filterToday(overnight, '23:30').length).toBe(1);
  });
});

// ---------- 完成状态叠加（与 WidgetDoneStore 同逻辑）----------
class DoneStore {
  done = new Set<number>();
  undone = new Set<number>();

  isDone(id: number, snapshotDone: number[]): boolean {
    if (this.undone.has(id)) return false;
    if (snapshotDone.includes(id)) return true;
    return this.done.has(id);
  }

  toggle(id: number, target: boolean) {
    if (target) { this.done.add(id); this.undone.delete(id); }
    else { this.done.delete(id); this.undone.add(id); }
  }

  markAllDone(ids: number[]) {
    for (const id of ids) { this.done.add(id); this.undone.delete(id); }
  }
}

describe('待办完成状态', () => {
  it('桌面点按后立即视为已完成（快照尚未更新）', () => {
    const s = new DoneStore();
    expect(s.isDone(1, [])).toBe(false);
    s.toggle(1, true);
    expect(s.isDone(1, [])).toBe(true);
  });

  it('快照里已完成、桌面又取消，则视为未完成', () => {
    const s = new DoneStore();
    s.toggle(2, false);
    expect(s.isDone(2, [2])).toBe(false);
  });

  it('来回点按不会状态错乱：最终以最后一次为准', () => {
    const s = new DoneStore();
    s.toggle(3, true);
    s.toggle(3, false);
    expect(s.isDone(3, [])).toBe(false);
    s.toggle(3, true);
    expect(s.isDone(3, [])).toBe(true);
    // 两个集合互斥，不应同时存在
    expect(s.done.has(3) && s.undone.has(3)).toBe(false);
  });

  it('全部完成把当前展示的待办都标记为完成', () => {
    const s = new DoneStore();
    s.markAllDone([1, 2, 3]);
    expect([1, 2, 3].every((id) => s.isDone(id, []))).toBe(true);
  });

  it('全部完成不覆盖此前的手动取消', () => {
    const s = new DoneStore();
    s.toggle(5, false);          // 用户先取消第 5 条
    s.markAllDone([4, 5, 6]);    // 再点全部完成
    expect(s.isDone(5, [5])).toBe(true); // 以"全部完成"为准
  });
});

describe('待办排序：完成的排末尾', () => {
  interface T { id: number; priority: string; done: boolean }

  function order(list: T[]): number[] {
    const pending = list.filter((t) => !t.done);
    const done = list.filter((t) => t.done);
    return [...pending, ...done].map((t) => t.id);
  }

  it('未完成在前，已完成的沉到底部', () => {
    const list: T[] = [
      { id: 1, priority: 'normal', done: false },
      { id: 2, priority: 'urgent-important', done: true },
      { id: 3, priority: 'important', done: false },
    ];
    expect(order(list)).toEqual([1, 3, 2]);
  });
});
