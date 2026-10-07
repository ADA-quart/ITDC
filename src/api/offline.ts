// 离线层：IndexedDB 缓存待办 + 日历事件，网络断开时仍可读写本地数据
import type { Todo, Calendar, CalendarEvent } from '../types';

const DB_NAME = 'itdc-offline-v1';
const STORE = 'store';
const STORE_VERSION = 2;

interface OfflineOp {
  op: 'create' | 'update' | 'delete' | 'split'
    | 'create-calendar' | 'update-calendar' | 'delete-calendar'
    | 'create-event' | 'update-event' | 'delete-event';
  id?: number;
  data?: any;
  ts: number;
}

interface KVStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: any): Promise<void>;
}

// IndexedDB 不可用时的内存兜底：读写真实生效（旧实现是空桩，缓存永远为空）
const memoryData = new Map<string, any>();
const memoryStore: KVStore = {
  get: async <T,>(key: string) => memoryData.get(key) as T | undefined,
  set: async (key: string, value: any) => { memoryData.set(key, value); },
};

let storePromise: Promise<KVStore> | null = null;

function idbStore(db: IDBDatabase): KVStore {
  return {
    get<T>(key: string): Promise<T | undefined> {
      return new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const r = tx.objectStore(STORE).get(key);
        r.onsuccess = () => resolve((r.result?.value ?? undefined) as T | undefined);
        r.onerror = () => reject(r.error ?? new Error('IndexedDB get failed'));
      });
    },
    set(key: string, value: any): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ key, value });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB set failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB set aborted'));
      });
    },
  };
}

function openIndexedDB(): Promise<KVStore> {
  return new Promise<KVStore>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, STORE_VERSION);
    req.onupgradeneeded = () => {
      // 升级事务进行中只能经 req.result 建表：此处调用 db.transaction() 会抛
      // InvalidStateError（A version change transaction is running），使 open 失败、离线层整体失效。
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 其它页面请求升级时主动让路，避免版本升级被本连接长久阻塞
      db.onversionchange = () => db.close();
      resolve(idbStore(db));
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

function getStore(): Promise<KVStore> {
  if (!storePromise) {
    storePromise = openIndexedDB().catch((err) => {
      console.warn('IndexedDB 不可用，离线缓存降级为内存存储:', err?.message ?? err);
      return memoryStore;
    });
  }
  return storePromise;
}

// ---------- 存储辅助 ----------
async function get<T>(key: string): Promise<T | undefined> {
  const store = await getStore();
  return store.get<T>(key);
}

async function set(key: string, value: any): Promise<void> {
  const store = await getStore();
  await store.set(key, value);
}

// 通用键值读写：外观设置里的背景图体积远超 localStorage 配额，改存 IndexedDB
export async function kvGet<T>(key: string): Promise<T | undefined> {
  return get<T>(key);
}

export async function kvSet(key: string, value: any): Promise<void> {
  await set(key, value);
}

// ---------- 响应值归一化 ----------
// 服务器或中间层可能返回非数组：典型场景是 Capacitor 本地服务器把未命中的 /api/* 回退成 index.html
export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

// 服务器或中间层可能返回非数组：典型场景是 Capacitor 本地服务器把未命中的 /api/* 回退成 index.html
export function malformedResponseError(what: string): Error {
  const err = new Error('接口返回格式异常：' + what + ' 不是数组') as Error & { malformedResponse?: boolean };
  err.malformedResponse = true;
  return err;
}

export function requireArray<T>(value: unknown, what: string): T[] {
  if (Array.isArray(value)) return value as T[];
  const head = typeof value === 'string'
    ? value.slice(0, 30).split(String.fromCharCode(10)).join(' ')
    : typeof value;
  console.warn('[api] ' + what + ' 返回的不是数组（收到 ' + head + '），按网络故障回退离线缓存');
  throw malformedResponseError(what);
}

export function isMalformedResponseError(err: unknown): boolean {
  return (err as { malformedResponse?: boolean } | null | undefined)?.malformedResponse === true;
}

// 单实体响应校验：Post/Put 也可能被中间层替换成 HTML（200 + index.html），
// 若不加校验会把字符串当成业务对象写进缓存，后续渲染时才崩。
export function requireEntity<T>(value: unknown, what: string): T {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { id?: unknown }).id === 'number') {
    return value as T;
  }
  const head = typeof value === 'string'
    ? value.slice(0, 30).split(String.fromCharCode(10)).join(' ')
    : typeof value;
  console.warn('[api] ' + what + ' 返回的不是有效对象（收到 ' + head + '），按网络故障处理');
  throw malformedResponseError(what);
}

// ---------- 待办缓存读写 ----------
export async function getCachedTodos(): Promise<Todo[]> {
  try {
    return asArray<Todo>(await get<Todo[]>('todos'));
  } catch {
    return [];
  }
}

export async function saveCachedTodos(todos: Todo[]): Promise<void> {
  try { await set('todos', todos); } catch {}
}

// ---------- 日历缓存读写 ----------
export async function getCalendarCache(): Promise<Calendar[]> {
  try {
    return asArray<Calendar>(await get<Calendar[]>('calendars'));
  } catch {
    return [];
  }
}

export async function saveCalendarCache(calendars: Calendar[]): Promise<void> {
  try { await set('calendars', calendars); } catch {}
}

/**
 * 修复旧版本可能产生的重复日历 ID。
 *
 * 旧版本 iCal 导入用「最大 ID + 1」、本机创建日历用另一套自增序列，先导 iCal
 * 再导教务时会撞出同一个 calendar_id。这里把重复项拆成新 ID，并按事件 source
 * 把 iCal 事件与教务事件重新归属到各自日历。
 */
export async function repairDuplicateCalendarIds(): Promise<boolean> {
  const calendars = await getCalendarCache();
  if (calendars.length < 2) return false;
  const events = await getEventCache();
  const seen = new Set<number>();
  let nextId = Math.max(0, ...calendars.map((c) => c.id), ...events.map((e) => e.calendar_id)) + 1;
  let changed = false;

  const nextCalendars = calendars.map((calendar) => {
    if (!seen.has(calendar.id)) {
      seen.add(calendar.id);
      return calendar;
    }
    const oldId = calendar.id;
    const newId = nextId++;
    const isIcal = calendar.source === 'ical';
    const isSchool = calendar.name.startsWith('教务课表')
      || (!!calendar.source && calendar.source !== 'manual' && calendar.source !== 'ical');
    for (const event of events) {
      if (event.calendar_id !== oldId) continue;
      const matches = isIcal
        ? event.source === 'ical'
        : isSchool
          ? !!event.source && event.source !== 'ical' && event.source !== 'manual'
          : event.source === 'manual';
      if (matches) event.calendar_id = newId;
    }
    changed = true;
    return { ...calendar, id: newId };
  });

  if (!changed) return false;
  await saveCalendarCache(nextCalendars);
  await saveEventCache(events);
  return true;
}

export async function getEventCache(): Promise<CalendarEvent[]> {
  try {
    return asArray<CalendarEvent>(await get<CalendarEvent[]>('events'));
  } catch {
    return [];
  }
}

export async function saveEventCache(events: CalendarEvent[]): Promise<void> {
  try { await set('events', events); } catch {}
}

// ---------- 删除墓碑 ----------
// 本地删掉的记录要留个标记：否则下次与服务器合并时，
// 服务端那条还在，会被当成"只有服务器有"又同步回来。
export interface Tombstone {
  uid: string;
  table: 'todos' | 'calendars' | 'events';
  ts: number;
}

export async function getTombstones(): Promise<Tombstone[]> {
  try {
    return asArray<Tombstone>(await get<Tombstone[]>('tombstones'));
  } catch {
    return [];
  }
}

export async function addTombstone(table: Tombstone['table'], uid: string | undefined): Promise<void> {
  if (!uid) return;
  try {
    const list = await getTombstones();
    if (!list.some((t) => t.uid === uid && t.table === table)) {
      list.push({ uid, table, ts: Date.now() });
      await set('tombstones', list);
    }
  } catch { /* 墓碑写入失败只影响下次合并，不阻断删除本身 */ }
}

export async function clearTombstones(): Promise<void> {
  try { await set('tombstones', []); } catch {}
}

// ---------- 本地 ID（离线时生成临时 ID，同步后以服务器返回为准） ----------
let localSeq = Date.now() % 1000000;
function nextLocalId(): number {
  return ++localSeq;
}

/**
 * 生成跨设备稳定标识。
 * 合并同步靠它匹配同一条记录 —— 自增 id 在各端空间不一致
 * （本机是时间戳派生的大数字，服务端从 1 开始），按 id 对齐会张冠李戴。
 */
export function makeSyncUid(prefix: string): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return prefix + '-' + crypto.randomUUID();
    }
  } catch { /* 降级到下面的随机串 */ }
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// ---------- 待办本地模拟 ----------
export function localCreate(data: Partial<Todo>): Todo {
  const now = new Date().toISOString();
  const u = Math.max(1, Math.min(4, Math.round(data.urgency ?? 2)));
  const i = Math.max(1, Math.min(4, Math.round(data.importance ?? 2)));
  let priority: Todo['priority'] = 'normal';
  if (u >= 3 && i >= 3) priority = 'urgent-important';
  else if (i >= 3) priority = 'important';
  else if (u >= 3) priority = 'urgent';
  const todo: Todo = {
    id: nextLocalId(),
    sync_uid: data.sync_uid || makeSyncUid('todo'),
    updated_at: now,
    title: data.title || '',
    description: data.description ?? null,
    estimated_minutes: data.estimated_minutes ?? 30,
    priority: data.priority || priority,
    urgency: u,
    importance: i,
    can_do_in_class: !!data.can_do_in_class,
    deadline: data.deadline ?? null,
    status: (data.status || 'pending') as Todo['status'],
    scheduled_start: data.scheduled_start ?? null,
    scheduled_end: data.scheduled_end ?? null,
    color: data.color ?? null,
    completed_at: null,
    created_at: now,
  };
  return todo;
}

export function localUpdate(todo: Todo, data: Partial<Todo>): Todo {
  const updated = { ...todo, ...data } as Todo;
  if (data.status === 'done') updated.completed_at = new Date().toISOString();
  else if (data.status) updated.completed_at = null;
  // 每次修改刷新 updated_at：合并时用它判断哪一端更新
  updated.updated_at = new Date().toISOString();
  return updated;
}

export function localSplit(todo: Todo, segments: { start: string; end: string }[]): Todo[] {
  const result: Todo[] = [
    { ...todo, status: 'scheduled', scheduled_start: segments[0].start, scheduled_end: segments[segments.length - 1].end },
  ];
  for (let i = 1; i < segments.length; i++) {
    const mins = Math.round((new Date(segments[i].end).getTime() - new Date(segments[i].start).getTime()) / 60000);
    result.push({
      ...todo,
      id: nextLocalId(),
      title: todo.title + ' (' + (i + 1) + '/' + segments.length + ')',
      estimated_minutes: mins,
      status: 'scheduled',
      scheduled_start: segments[i].start,
      scheduled_end: segments[i].end,
    });
  }
  return result;
}

export function localDelete(todos: Todo[], id: number): Todo[] {
  return todos.filter((t) => t.id !== id);
}

// ---------- 日历本地模拟 ----------
export function localCreateCalendar(data: Partial<Calendar>): Calendar {
  const now = new Date().toISOString();
  return {
    id: nextLocalId(),
    sync_uid: data.sync_uid || makeSyncUid('cal'),
    updated_at: now,
    name: data.name || 'New calendar',
    color: data.color || '#1890ff',
    source: data.source || 'manual',
    created_at: now,
  };
}
// 删除日历：连带删掉它的事件（本地）
export function localDeleteCalendar(calendars: Calendar[], events: CalendarEvent[], id: number): { calendars: Calendar[]; events: CalendarEvent[] } {
  return {
    calendars: calendars.filter(c => c.id !== id),
    events: events.filter(e => e.calendar_id !== id),
  };
}

export function localCreateEvent(data: Partial<CalendarEvent>): CalendarEvent {
  const now = new Date().toISOString();
  return {
    id: nextLocalId(),
    sync_uid: data.sync_uid || makeSyncUid('evt'),
    updated_at: now,
    calendar_id: data.calendar_id ?? 0,
    title: data.title || 'Untitled',
    description: data.description ?? null,
    start_time: data.start_time || now,
    end_time: data.end_time || now,
    rrule: data.rrule ?? null,
    location: data.location ?? null,
    color: data.color ?? null,
    // 保留调用方给的 source（教务导入靠它识别课表事件，用于上课提醒）；
    // 之前这里写死 'manual'，导入的课全被当成手工事件，提醒一直排不上
    source: data.source || 'manual',
    uid: null,
    created_at: now,
  };
}

export function localUpdateEvent(events: CalendarEvent[], id: number, data: Partial<CalendarEvent>): CalendarEvent[] {
  return events.map(e => (e.id === id ? { ...e, ...data } : e));
}

export function localDeleteEvent(events: CalendarEvent[], id: number): CalendarEvent[] {
  return events.filter(e => e.id !== id);
}

// ---------- 在线状态 ----------
export type OnlineListener = (online: boolean) => void;

const listeners: OnlineListener[] = [];

function notify(online: boolean) {
  for (const l of listeners) l(online);
}

if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
  window.addEventListener('online', () => notify(true));
  window.addEventListener('offline', () => notify(false));
}

export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  // onLine 可能为 undefined（非标准环境），只有明确 false 才视为离线
  return navigator.onLine !== false;
}

export function onOnlineChange(cb: OnlineListener): void {
  listeners.push(cb);
  cb(navigator?.onLine ?? true);
}
