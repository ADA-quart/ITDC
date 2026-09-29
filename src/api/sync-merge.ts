// 合并同步：切换服务器时把本机与服务器的数据合到一起，而不是以某一端覆盖另一端。
//
// 对应关系参考 Edge 收藏夹同步的行为：
//   - 两端都有的记录（按 uid 匹配）→ 比较 updated_at，新的赢
//   - 只有一端有的 → 保留（补到另一端）
//   - 删除 → 靠墓碑标记，两端一起删掉
//
// 为什么必须用 uid 而不是自增 id：
// 本机 id 是时间戳派生的大数字（约 81 万），服务端从 1 开始自增。
// 按 id 对齐会把 A 端第 N 条错配成 B 端第 N 条，导致改错数据。
import { api } from './client';
import * as offline from './offline';
import type { Calendar, CalendarEvent, Todo } from '../types';

export interface MergeResult {
  todos: number;
  calendars: number;
  events: number;
  added: number;
  updated: number;
  removed: number;
}

interface MergeResponse {
  success: boolean;
  todos: Todo[];
  calendars: Calendar[];
  events: CalendarEvent[];
  tombstones: { uid: string; table_name: string }[];
  stats: { added: number; updated: number; removed: number };
}

/**
 * 把本机数据推给服务端合并，并用合并结果替换本地缓存。
 *
 * 合并由服务端完成（它能拿到全量服务端数据），客户端负责：
 *   1. 提交本机全量 + 本地墓碑
 *   2. 用返回的全量结果替换本地缓存
 *   3. 清掉已被服务端确认的墓碑
 */
export async function mergeWithServer(): Promise<MergeResult> {
  const [todos, calendars, events, tombstones] = await Promise.all([
    offline.getCachedTodos(),
    offline.getCalendarCache(),
    offline.getEventCache(),
    offline.getTombstones(),
  ]);

  // 给改造前创建的历史数据补 sync_uid。
  // 服务端按 sync_uid 匹配，缺失的记录会被跳过 —— 那等于在合并时把它们弄丢。
  let patched = false;
  const todosFixed = todos.map((t) => {
    if (t.sync_uid) return t;
    patched = true;
    return { ...t, sync_uid: offline.makeSyncUid('todo'), updated_at: t.updated_at || t.created_at };
  });
  const calendarsFixed = calendars.map((c) => {
    if (c.sync_uid) return c;
    patched = true;
    return { ...c, sync_uid: offline.makeSyncUid('cal'), updated_at: c.updated_at || c.created_at };
  });
  const eventsFixed = events.map((e) => {
    if (e.sync_uid) return e;
    patched = true;
    return { ...e, sync_uid: offline.makeSyncUid('evt'), updated_at: e.updated_at || e.created_at };
  });
  if (patched) {
    await offline.saveCachedTodos(todosFixed);
    await offline.saveCalendarCache(calendarsFixed);
    await offline.saveEventCache(eventsFixed);
  }

  // 事件要带上所属日历的 uid：两端日历 id 不同，只能靠 uid 建立对应
  const calendarUidById = new Map<number, string>();
  for (const c of calendarsFixed) {
    if (c.sync_uid) calendarUidById.set(c.id, c.sync_uid);
  }
  const eventsWithCalUid = eventsFixed.map((e) => ({
    ...e,
    calendar_uid: calendarUidById.get(e.calendar_id) || null,
  }));

  const payload = {
    todos: todosFixed,
    calendars: calendarsFixed,
    events: eventsWithCalUid,
    deleted: {
      todos: tombstones.filter((t) => t.table === 'todos').map((t) => t.uid),
      calendars: tombstones.filter((t) => t.table === 'calendars').map((t) => t.uid),
      events: tombstones.filter((t) => t.table === 'events').map((t) => t.uid),
    },
  };

  const res = await api.post<MergeResponse>('/sync/merge', payload);
  const data = res.data;

  if (!data?.success) {
    throw new Error('合并同步失败');
  }

  // 用合并后的全量替换本地（此时已含两端所有记录）
  await offline.saveCachedTodos(Array.isArray(data.todos) ? data.todos : []);
  await offline.saveCalendarCache(Array.isArray(data.calendars) ? data.calendars : []);
  await offline.saveEventCache(Array.isArray(data.events) ? data.events : []);

  // 服务端已记录这些删除，本地墓碑可以清掉了
  await offline.clearTombstones();

  return {
    todos: data.todos?.length ?? 0,
    calendars: data.calendars?.length ?? 0,
    events: data.events?.length ?? 0,
    added: data.stats?.added ?? 0,
    updated: data.stats?.updated ?? 0,
    removed: data.stats?.removed ?? 0,
  };
}
