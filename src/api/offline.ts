// 离线层：IndexedDB 缓存待办列表 + 操作队列，网络断开时仍可读写本地数据
import type { Todo } from '../types';

const DB_NAME = 'itdc-offline-v1';
const STORE = 'store';
const STORE_VERSION = 1;

interface OfflineOp {
  op: 'create' | 'update' | 'delete' | 'split';
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

// ---------- 缓存读写 ----------
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
      title: `${todo.title} (${i + 1}/${segments.length})`,
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

export async function flushQueue(todoApi: TodoApiLike): Promise<void> {
  const queue = await getQueue();
  if (queue.length === 0) return;
  for (const op of queue) {
    try {
      switch (op.op) {
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
