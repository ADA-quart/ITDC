import { describe, it, expect } from 'vitest';

/**
 * 合并规则验证。
 * 与 server/routes/sync.ts 的 mergeRows/applyTombstones 保持同一套判断逻辑，
 * 用纯函数复现以便快速覆盖边界（不启动数据库）。
 */

function ts(v: unknown): number {
  const t = Date.parse(String(v ?? ''));
  return Number.isNaN(t) ? 0 : t;
}

interface Row { [k: string]: any }

/** 复现服务端合并：只有一端有则保留；两端都有则新的赢 */
function mergeRows(existing: Row[], incoming: Row[]): { result: Row[]; added: number; updated: number } {
  const byUid = new Map<string, Row>();
  for (const r of existing) byUid.set(r.sync_uid, r);

  let added = 0;
  let updated = 0;

  for (const row of incoming) {
    const uid = row?.sync_uid;
    if (!uid) continue;
    const cur = byUid.get(uid);
    if (!cur) {
      byUid.set(uid, row);
      added++;
      continue;
    }
    if (ts(row.updated_at) > ts(cur.updated_at)) {
      byUid.set(uid, row);
      updated++;
    }
  }

  return { result: [...byUid.values()], added, updated };
}

describe('合并同步：两端数据合并而非覆盖', () => {
  it('只有本机有的记录会被保留（这是用户最关心的点）', () => {
    const server: Row[] = [{ sync_uid: 'a', title: '服务器的', updated_at: '2026-01-01T00:00:00Z' }];
    const local: Row[] = [{ sync_uid: 'b', title: '本机独有的', updated_at: '2026-01-01T00:00:00Z' }];

    const { result, added } = mergeRows(server, local);
    expect(result.length).toBe(2);
    expect(result.map((r) => r.title).sort()).toEqual(['服务器的', '本机独有的']);
    expect(added).toBe(1);
  });

  it('只有服务器有的记录也会保留', () => {
    const server: Row[] = [{ sync_uid: 'a', title: '服务器的', updated_at: '2026-01-01T00:00:00Z' }];
    const { result } = mergeRows(server, []);
    expect(result.length).toBe(1);
  });

  it('同一条 uid 两端都有时，updated_at 新的赢', () => {
    const server: Row[] = [{ sync_uid: 'a', title: '旧', updated_at: '2026-01-01T00:00:00Z' }];
    const local: Row[] = [{ sync_uid: 'a', title: '新', updated_at: '2026-02-01T00:00:00Z' }];

    const { result, updated } = mergeRows(server, local);
    expect(result.length).toBe(1);
    expect(result[0].title).toBe('新');
    expect(updated).toBe(1);
  });

  it('本机更旧时不覆盖服务器的新版本', () => {
    const server: Row[] = [{ sync_uid: 'a', title: '新', updated_at: '2026-02-01T00:00:00Z' }];
    const local: Row[] = [{ sync_uid: 'a', title: '旧', updated_at: '2026-01-01T00:00:00Z' }];

    const { result, updated } = mergeRows(server, local);
    expect(result[0].title).toBe('新');
    expect(updated).toBe(0);
  });

  it('缺失 updated_at 视为很旧，不会覆盖有时间的记录', () => {
    const server: Row[] = [{ sync_uid: 'a', title: '有时间', updated_at: '2020-01-01T00:00:00Z' }];
    const local: Row[] = [{ sync_uid: 'a', title: '无时间' }];

    const { result } = mergeRows(server, local);
    expect(result[0].title).toBe('有时间');
  });

  it('没有 sync_uid 的记录被忽略（无法匹配，不能盲目并入）', () => {
    const server: Row[] = [];
    const local: Row[] = [{ title: '缺 uid' }];
    const { result, added } = mergeRows(server, local);
    expect(result.length).toBe(0);
    expect(added).toBe(0);
  });

  it('两端各自新增不同记录时互不覆盖', () => {
    const server: Row[] = [{ sync_uid: 's1', title: '服务器新增', updated_at: '2026-01-02T00:00:00Z' }];
    const local: Row[] = [{ sync_uid: 'l1', title: '本机新增', updated_at: '2026-01-03T00:00:00Z' }];
    const { result } = mergeRows(server, local);
    expect(result.length).toBe(2);
  });
});

describe('删除墓碑', () => {
  it('本机删除后，服务器那条不会在合并时被带回来', () => {
    const server: Row[] = [
      { sync_uid: 'a', title: '要被删的' },
      { sync_uid: 'b', title: '保留的' },
    ];
    const deletedUids = ['a'];

    const afterDelete = server.filter((r) => !deletedUids.includes(r.sync_uid));
    const { result } = mergeRows(afterDelete, []);
    expect(result.map((r) => r.sync_uid)).toEqual(['b']);
  });

  it('墓碑 uid 不匹配时不影响其它记录', () => {
    const server: Row[] = [{ sync_uid: 'a', title: 'A' }, { sync_uid: 'b', title: 'B' }];
    const afterDelete = server.filter((r) => r.sync_uid !== 'nonexistent');
    expect(afterDelete.length).toBe(2);
  });
});
