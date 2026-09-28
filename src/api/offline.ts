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

// ---------- 响应值归一化 ----------
// 服务器或中间层可能返回非数组：典型场景是 Capacitor 本地服务器把未命中的 /api/* 回退成 index.html
export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

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

// ---------- 队列 ----------
async function getQueue(): Promise<OfflineOp[]> {
  try {
    return asArray<OfflineOp>(await get<OfflineOp[]>('queue'));
  } catch {
    return [];
  }
}

export async function enqueue(op: OfflineOp): Promise<void> {
  try {
    const q = await getQueue();
    q.push(op);
    await set('queue', q);
  } catch (err) {
    // 入队失败只影响后续同步，本地数据此前已写入缓存；此处吞掉，避免冒泡成未处理拒绝
    console.warn('离线队列写入失败:', err);
  }
}

export async function clearQueue(): Promise<void> {
  try { await set('queue', []); } catch {}
}

// ---------- 本地 ID（离线时生成临时 ID，同步后以服务器返回为准） ----------
let localSeq = Date.now() % 1000000;
function nextLocalId(): number {
  return ++localSeq;
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
    title: data.title || '',
    description: data.description ?? null,
    estimated_minutes: data.estimated_minutes ?? 30,
    priority: data.priority || priority,
    urgency: u,
    importance: i,
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
    name: data.name || 'New calendar',
    color: data.color || '#1890ff',
    source: 'manual',
    created_at: now,
  };
}

export function localUpdateCalendar(calendars: Calendar[], id: number, data: Partial<Calendar>): Calendar[] {
  return calendars.map(c => (c.id === id ? { ...c, ...data } : c));
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
    calendar_id: data.calendar_id ?? 0,
    title: data.title || 'Untitled',
    description: data.description ?? null,
    start_time: data.start_time || now,
    end_time: data.end_time || now,
    rrule: data.rrule ?? null,
    location: data.location ?? null,
    source: 'manual',
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

// ---------- flush：把队列里的操作按顺序发到服务器 ----------
export interface TodoApiLike {
  getAll: (params?: any) => Promise<Todo[]>;
  create: (data: Partial<Todo>) => Promise<Todo>;
  update: (id: number, data: Partial<Todo>) => Promise<Todo>;
  delete: (id: number) => Promise<{ success: boolean }>;
  split: (id: number, segments: { start: string; end: string }[]) => Promise<Todo>;
  parseNL: (text: string) => Promise<Todo>;
}

export interface CalendarApiLike {
  getAll: () => Promise<Calendar[]>;
  create: (data: Partial<Calendar>) => Promise<Calendar>;
  delete: (id: number) => Promise<any>;
  getEvents: () => Promise<CalendarEvent[]>;
  createEvent: (data: Partial<CalendarEvent>) => Promise<CalendarEvent>;
  updateEvent: (id: number, data: Partial<CalendarEvent>) => Promise<CalendarEvent>;
  deleteEvent: (id: number) => Promise<any>;
}

// 服务器 404：目标资源已不存在（例如离线期间被别处删除），该操作已失去意义
export function isStaleOperationError(err: any): boolean {
  return err?.response?.status === 404;
}

export async function flushQueue(todoApi: TodoApiLike, calendarApi?: CalendarApiLike): Promise<void> {
  const queue = await getQueue();
  if (queue.length === 0) return;
  for (const op of queue) {
    try {
      switch (op.op) {
        // ---- todo ----
        case 'create':
          await todoApi.create(op.data!);
          break;
        case 'update':
          await todoApi.update(op.id!, op.data!);
          break;
        case 'delete':
          await todoApi.delete(op.id!);
          break;
        case 'split':
          // 离线 split 的本地 ID 与服务器不匹配，跳过；重新拉取即可
          break;
        // ---- calendar ----
        case 'create-calendar':
          if (calendarApi) { await calendarApi.create(op.data!); } else { throw new Error('no calendar api'); }
          break;
        case 'update-calendar':
          // 服务器端无 update-calendar API，跳过；重新拉取即可
          break;
        case 'delete-calendar':
          if (calendarApi) { await calendarApi.delete(op.id!); } else { throw new Error('no calendar api'); }
          break;
        case 'create-event':
          if (calendarApi) { await calendarApi.createEvent(op.data!); } else { throw new Error('no calendar api'); }
          break;
        case 'update-event':
          // 服务器端 update 需要真实 ID；离线生成的临时 ID 不匹配 → 跳过，重新拉取即可
          break;
        case 'delete-event':
          if (calendarApi) { await calendarApi.deleteEvent(op.id!); } else { throw new Error('no calendar api'); }
          break;
      }
    } catch (err) {
      // 目标已不存在：丢弃该操作继续同步，避免整个队列被一条失效操作永久卡住
      if (isStaleOperationError(err)) continue;
      // 其它失败：保留它和后面的队列，下次再试
      const idx = queue.indexOf(op);
      await set('queue', [op, ...queue.slice(idx + 1)]);
      return;
    }
  }
  await clearQueue();
}
