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

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    const p: Promise<IDBDatabase> = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, STORE_VERSION);
      req.onsuccess = (e: any) => resolve(e.target.result as IDBDatabase);
      req.onerror = () => reject(new Error('IndexedDB open failed'));
      req.onupgradeneeded = (e: any) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.transaction(STORE).createObjectStore(STORE, { keyPath: 'key' });
        }
      };
    }).catch(() => {
      // IndexedDB 不可用（极少数环境）：降级为内存-only，不抛错
      const fallback = { get: async (k: string) => undefined as any, set: async () => {} } as unknown as IDBDatabase;
      return Promise.resolve(fallback);
    });
    dbPromise = p;
  }
  return dbPromise;
}

// ---------- 存储辅助 ----------
async function get<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  return (db as any).get(key);
}

async function set(key: string, value: any): Promise<void> {
  const db = await openDB();
  await (db as any).set(key, value);
}

// ---------- 待办缓存读写 ----------
export async function getCachedTodos(): Promise<Todo[]> {
  try {
    return (await get<Todo[]>('todos')) ?? [];
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
    return (await get<Calendar[]>('calendars')) ?? [];
  } catch {
    return [];
  }
}

export async function saveCalendarCache(calendars: Calendar[]): Promise<void> {
  try { await set('calendars', calendars); } catch {}
}

export async function getEventCache(): Promise<CalendarEvent[]> {
  try {
    return (await get<CalendarEvent[]>('events')) ?? [];
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
    return (await get<OfflineOp[]>('queue')) ?? [];
  } catch {
    return [];
  }
}

export async function enqueue(op: OfflineOp): Promise<void> {
  const q = await getQueue();
  q.push(op);
  await set('queue', q);
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
    } catch {
      // 当前操作失败：保留它和后面的队列，下次再试
      const idx = queue.indexOf(op);
      await set('queue', [op, ...queue.slice(idx + 1)]);
      return;
    }
  }
  await clearQueue();
}
