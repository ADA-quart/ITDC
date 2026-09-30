import axios from 'axios';
import { message } from 'antd';
import type { Calendar, CalendarEvent, Todo, ScheduleResult, LLMConfig } from '../types';
import * as offline from './offline';
import { generateScheduleLocally, validateScheduleLocally } from './local-scheduler';
import { parseIcsFile, buildIcs, downloadBlob } from './local-ical';
import type { ModelListResult } from './llm-models';
import { generateLLMScheduleLocally } from './local-llm-scheduler';
import { parseNaturalLanguageTodoLocally } from './local-nl-todo';

const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE || '/api';

function resolveApiBase(): string | null {
  try {
    // 空字符串 = 用户显式选择"仅本地"，不走任何网络
    const raw = localStorage.getItem('itdc_api_base');
    if (raw === '') return null;
    return raw ?? DEFAULT_API_BASE;
  } catch {
    return DEFAULT_API_BASE;
  }
}

const api = axios.create({
  baseURL: resolveApiBase() ?? DEFAULT_API_BASE,
  timeout: 30000,
});

// 全局响应错误拦截器 — 统一处理网络错误和服务端异常
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isCancel(error)) {
      return Promise.reject(error);
    }

    const status = error?.response?.status;
    const serverMessage = error?.response?.data?.error || error?.response?.data?.message;

    // 4xx 客户端错误：由具体调用方处理（它们有自己的 catch 逻辑）
    // 仅对 5xx 服务端错误和无响应的场景弹出全局提示
    if (!error.response) {
      message.error('网络连接失败，请检查服务是否启动');
    } else if (status && status >= 500) {
      message.error(serverMessage || '服务器内部错误，请稍后重试');
    }

    return Promise.reject(error);
  }
);

// ---------- 同步开关 ----------
// null = 本机模式（不连服务器）；字符串 = 服务器地址
let syncBase: string | null = resolveApiBase();

// 会话内可达性探测结果。
// 初值 false = 本地优先：启动即走本机数据，探测到服务器可用后才接管，
// 避免无服务器环境下每次操作都白等一次网络超时。
let syncReachable = false;

export function isSyncEnabled(): boolean {
  return syncBase !== null && syncReachable;
}

/**
 * 探测服务器是否可用。
 * 用户填了地址 → 探到不可达则本次会话内退化为本机模式（数据不丢，只是不同步）。
 * 未填地址（默认）→ 尝试同源 /api：可达就用服务器，不可达就是纯本机。
 */
export async function probeSync(): Promise<boolean> {
  if (syncBase === null) { syncReachable = false; return false; }
  try {
    const res = await api.get('/health', { timeout: 4000 });
    syncReachable = res.data?.status === 'ok';
  } catch {
    syncReachable = false;
  }
  return syncReachable;
}

export function setApiBase(url: string | null): void {
  const normalized = url === null ? null : url;
  try {
    localStorage.setItem('itdc_api_base', normalized === null ? '' : normalized);
  } catch { /* 忽略存储失败 */ }
  syncBase = normalized;
  api.defaults.baseURL = normalized ?? DEFAULT_API_BASE;
  // 用户显式配置后允许尝试；真正可用与否由 probeSync 判定
  syncReachable = normalized !== null;
}

export function getApiBase(): string {
  return syncBase ?? '';
}

export { api };

// ---------- 服务器同步层（可选，仅在使用服务器时调用） ----------
const serverApi = {
  calendars: {
    getAll: () => api.get<unknown>('/calendar/calendars')
      .then(r => offline.requireArray<Calendar>(r.data, 'GET /calendar/calendars')),
    create: (data: Partial<Calendar>) => api.post<unknown>('/calendar/calendars', data)
      .then(r => offline.requireEntity<Calendar>(r.data, 'POST /calendar/calendars')),
    delete: (id: number) => api.delete(`/calendar/calendars/${id}`).then(r => r.data),
  },
  events: {
    getAll: () => api.get<unknown>('/calendar/events')
      .then(r => offline.requireArray<CalendarEvent>(r.data, 'GET /calendar/events')),
    create: (data: Partial<CalendarEvent>) => api.post<unknown>('/calendar/events', data)
      .then(r => offline.requireEntity<CalendarEvent>(r.data, 'POST /calendar/events')),
    update: (id: number, data: Partial<CalendarEvent>) => api.put<unknown>(`/calendar/events/${id}`, data)
      .then(r => offline.requireEntity<CalendarEvent>(r.data, 'PUT /calendar/events')),
    delete: (id: number) => api.delete(`/calendar/events/${id}`).then(r => r.data),
  },
  todos: {
    getAll: (params?: any) => api.get<unknown>('/todos', { params })
      .then(r => offline.requireArray<Todo>(r.data, 'GET /todos')),
    create: (data: Partial<Todo>) => api.post<unknown>('/todos', data)
      .then(r => offline.requireEntity<Todo>(r.data, 'POST /todos')),
    update: (id: number, data: Partial<Todo>) => api.put<unknown>(`/todos/${id}`, data)
      .then(r => offline.requireEntity<Todo>(r.data, 'PUT /todos')),
    delete: (id: number) => api.delete(`/todos/${id}`).then(r => r.data),
    split: (id: number, segments: { start: string; end: string }[]) =>
      api.post<unknown>(`/todos/${id}/split`, { segments })
        .then(r => offline.requireEntity<Todo>(r.data, 'POST /todos/:id/split')),
  },
};

// ---------- 离线模式标记（UI 横幅用） ----------
let offlineMode = false;
export function setOfflineMode(on: boolean) {
  if (offlineMode === on) return;
  offlineMode = on;
  window.dispatchEvent(new CustomEvent('todo-offline-mode', { detail: { mode: on } }));
}

function isNetworkError(err: any): boolean {
  // 网络层错误（无响应、超时、连接失败）或响应体格式异常（例如本地服务器把 /api/* 回退成 index.html），
  // 而非服务端 4xx/5xx —— 后者由调用方按业务错误处理
  return !err?.response || offline.isMalformedResponseError(err);
}

/**
 * 数据已变更的通知。
 * 独立事件名：只用于驱动桌面小组件快照刷新，不干扰各视图自身的重载逻辑。
 */
function notifyDataChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent('itdc-widget-sync'));
  } catch { /* 非浏览器环境忽略 */ }
}

// ---------- 本地 ID 分配：取现有数据最大 id + 1，避免与服务器 id 冲突 ----------
function nextIdFrom<T extends { id: number }>(rows: T[]): number {
  return rows.reduce((max, r) => Math.max(max, r.id), 0) + 1;
}

// ============================================================
// 本地为唯一数据源；启用服务器时，网络成功即写回本地缓存（服务器作镜像）。
// 网络失败一律降级为本地写入并完成操作，不再中断用户流程。
// ============================================================

// ---------- 待办 ----------
export const todoApi = {
  async getAll(params?: { status?: string; priority?: string }): Promise<Todo[]> {
    let todos: Todo[] | null = null;

    if (isSyncEnabled() && offline.isOnline()) {
      try {
        todos = await serverApi.todos.getAll(params);
        // 注意：这里**不再**用服务器数据覆盖本地缓存。
        // 否则本机独有的待办会在连上服务器的瞬间消失（各端数据无法合并）。
        // 两端的合并统一由 mergeWithServer() 负责，这里只做只读展示。
        if (!params?.status && !params?.priority) setOfflineMode(false);
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        setOfflineMode(true);
      }
    }

    if (todos === null) {
      todos = await offline.getCachedTodos();
      if (!isSyncEnabled()) setOfflineMode(false);
    }

    if (params?.status) todos = todos.filter((t) => t.status === params.status);
    if (params?.priority) todos = todos.filter((t) => t.priority === params.priority);

    return todos;
  },

  async create(data: Partial<Todo>): Promise<Todo> {
    const todos = await offline.getCachedTodos();
    const local = offline.localCreate(data);
    // 本地 id 与服务器 id 空间独立，重排一个本地 id 避免碰撞
    if (isSyncEnabled()) local.id = nextIdFrom(todos);

    if (isSyncEnabled() && offline.isOnline()) {
      try {
        const created = await serverApi.todos.create(data);
        await offline.saveCachedTodos([...todos, created]);
        setOfflineMode(false);
        notifyDataChanged();
        return created;
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        setOfflineMode(true);
      }
    }

    await offline.saveCachedTodos([...todos, local]);
    notifyDataChanged();
    return local;
  },

  async update(id: number, data: Partial<Todo>): Promise<Todo> {
    const todos = await offline.getCachedTodos();
    const idx = todos.findIndex((t) => t.id === id);
    const updatedLocal = idx >= 0 ? offline.localUpdate(todos[idx], data) : null;

    if (isSyncEnabled() && offline.isOnline()) {
      try {
        const updated = await serverApi.todos.update(id, data);
        const merged = idx >= 0
          ? todos.map((t) => (t.id === id ? updated : t))
          : [...todos, updated];
        await offline.saveCachedTodos(merged);
        setOfflineMode(false);
        notifyDataChanged();
        return updated;
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        setOfflineMode(true);
      }
    }

    if (!updatedLocal) throw new Error('待办不存在');
    await offline.saveCachedTodos(todos.map((t) => (t.id === id ? updatedLocal : t)));
    notifyDataChanged();
    return updatedLocal;
  },

  async delete(id: number): Promise<{ success: boolean }> {
    if (isSyncEnabled() && offline.isOnline()) {
      try {
        await serverApi.todos.delete(id);
        setOfflineMode(false);
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        setOfflineMode(true);
      }
    }

    const todos = await offline.getCachedTodos();
    // 先记墓碑再删：否则下次与服务器合并时，服务端那条还在，
    // 会被当成"只有服务器有"又同步回来
    const removed = todos.find((t) => t.id === id);
    await offline.addTombstone('todos', removed?.sync_uid);
    await offline.saveCachedTodos(offline.localDelete(todos, id));
    notifyDataChanged();
    return { success: true };
  },

  async split(id: number, segments: { start: string; end: string }[]): Promise<Todo> {
    if (isSyncEnabled() && offline.isOnline()) {
      try {
        const todo = await serverApi.todos.split(id, segments);
        setOfflineMode(false);
        return todo;
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        setOfflineMode(true);
      }
    }

    const todos = await offline.getCachedTodos();
    const idx = todos.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error('待办不存在');
    const replaced = offline.localSplit(todos[idx], segments);
    todos.splice(idx, 1, ...replaced);
    await offline.saveCachedTodos(todos);
    notifyDataChanged();
    return replaced[0];
  },

  // 自然语言录入需要 LLM：服务器模式交给服务器，本机模式由 App 直连大模型
  async parseNL(text: string): Promise<Todo> {
    if (!isSyncEnabled()) {
      const parsed = await parseNaturalLanguageTodoLocally(text);
      const todos = await offline.getCachedTodos();
      const created = offline.localCreate({
        title: parsed.title,
        estimated_minutes: parsed.estimated_minutes,
        priority: parsed.priority as Todo['priority'],
        urgency: parsed.urgency,
        importance: parsed.importance,
        deadline: parsed.deadline,
      });
      todos.push(created);
      await offline.saveCachedTodos(todos);
      notifyDataChanged();
      return created;
    }
    return api.post<Todo>('/todos/nl', { text }).then(r => r.data);
  },
};

// ---------- 日历 ----------
export const calendarApi = {
  async getAll(): Promise<Calendar[]> {
    if (isSyncEnabled() && offline.isOnline()) {
      try {
        const data = await serverApi.calendars.getAll();
        // 不用服务器数据覆盖本地：合并交给 mergeWithServer()，否则本机独有的日历会消失
        setOfflineMode(false);
        return data;
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        setOfflineMode(true);
      }
    }
    return offline.getCalendarCache();
  },

  async create(data: Partial<Calendar>): Promise<Calendar> {
    const cached = await offline.getCalendarCache();

    if (isSyncEnabled() && offline.isOnline()) {
      try {
        const cal = await serverApi.calendars.create(data);
        await offline.saveCalendarCache([...cached.filter((c) => c.id !== cal.id), cal]);
        setOfflineMode(false);
        return cal;
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        setOfflineMode(true);
      }
    }

    const local = offline.localCreateCalendar(data);
    if (isSyncEnabled()) local.id = nextIdFrom(cached);
    await offline.saveCalendarCache([...cached, local]);
    return local;
  },

  async delete(id: number): Promise<any> {
    if (isSyncEnabled() && offline.isOnline()) {
      try {
        await serverApi.calendars.delete(id);
        setOfflineMode(false);
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        setOfflineMode(true);
      }
    }

    const calC = await offline.getCalendarCache();
    const evC = await offline.getEventCache();
    const { calendars, events } = offline.localDeleteCalendar(calC, evC, id);
    await offline.saveCalendarCache(calendars);
    await offline.saveEventCache(events);
    notifyDataChanged();
    return { success: true };
  },

  async getEvents(): Promise<CalendarEvent[]> {
    if (isSyncEnabled() && offline.isOnline()) {
      try {
        const data = await serverApi.events.getAll();
        // 同上：不覆盖本地，避免本机独有的事件在连接服务器后消失
        setOfflineMode(false);
        return data;
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        setOfflineMode(true);
      }
    }
    return offline.getEventCache();
  },

  async createEvent(data: Partial<CalendarEvent>): Promise<CalendarEvent> {
    const cached = await offline.getEventCache();

    if (isSyncEnabled() && offline.isOnline()) {
      try {
        const evt = await serverApi.events.create(data);
        await offline.saveEventCache([...cached.filter((e) => e.id !== evt.id), evt]);
        setOfflineMode(false);
        return evt;
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        setOfflineMode(true);
      }
    }

    const local = offline.localCreateEvent(data);
    if (isSyncEnabled()) local.id = nextIdFrom(cached);
    await offline.saveEventCache([...cached, local]);
    return local;
  },

  async updateEvent(id: number, data: Partial<CalendarEvent>): Promise<CalendarEvent> {
    const cached = await offline.getEventCache();

    if (isSyncEnabled() && offline.isOnline()) {
      try {
        const evt = await serverApi.events.update(id, data);
        await offline.saveEventCache([...cached.filter((e) => e.id !== evt.id), evt]);
        setOfflineMode(false);
        return evt;
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        setOfflineMode(true);
      }
    }

    const updated = offline.localUpdateEvent(cached, id, data);
    await offline.saveEventCache(updated);
    return updated.find((e) => e.id === id) ?? ({ ...data } as CalendarEvent);
  },

  async deleteEvent(id: number): Promise<any> {
    if (isSyncEnabled() && offline.isOnline()) {
      try {
        await serverApi.events.delete(id);
        setOfflineMode(false);
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        setOfflineMode(true);
      }
    }

    const cached = await offline.getEventCache();
    const removedEvt = cached.find((e) => e.id === id);
    await offline.addTombstone('events', removedEvt?.sync_uid);
    await offline.saveEventCache(offline.localDeleteEvent(cached, id));
    notifyDataChanged();
    return { success: true };
  },

  // iCal 导入：本地解析并写入本地数据，无需服务器
  async importIcs(file: File, calendarName?: string, calendarColor?: string): Promise<{ imported_count: number }> {
    const text = await file.text();
    const parsed = parseIcsFile(text);
    if (parsed.length === 0) throw new Error('未找到有效事件');

    const calendars = await offline.getCalendarCache();
    const events = await offline.getEventCache();

    const newCalendar: Calendar = {
      id: nextIdFrom(calendars),
      name: calendarName || '导入日历',
      color: calendarColor || '#52c41a',
      source: 'ical',
      created_at: new Date().toISOString(),
    };

    const importedEvents: CalendarEvent[] = [];
    let idCursor = nextIdFrom(events);
    for (const ev of parsed) {
      importedEvents.push({
        id: idCursor++,
        calendar_id: newCalendar.id,
        title: ev.title,
        description: ev.description || null,
        start_time: ev.startTime,
        end_time: ev.endTime,
        rrule: ev.rrule,
        location: ev.location,
        source: 'ical',
        uid: ev.uid,
        created_at: new Date().toISOString(),
      });
    }

    await offline.saveCalendarCache([...calendars, newCalendar]);
    await offline.saveEventCache([...events, ...importedEvents]);

    return { imported_count: importedEvents.length };
  },

  // 导出 iCal：本地生成文件
  async exportIcal(lang: 'zh' | 'en' = 'zh'): Promise<void> {
    const events = await offline.getEventCache();
    const todos = await offline.getCachedTodos();
    const calendars = await offline.getCalendarCache();

    const calNameById = new Map(calendars.map((c) => [c.id, c.name]));
    const prefix = lang === 'zh' ? '[待办] ' : '[Todo] ';

    const items = [
      ...events.map((e) => ({
        title: e.title,
        description: e.description,
        location: e.location,
        rrule: e.rrule,
        uid: e.uid || `event-${e.id}@local`,
        startTime: e.start_time,
        endTime: e.end_time,
      })),
      ...todos
        .filter((t) => t.status === 'scheduled' && t.scheduled_start && t.scheduled_end)
        .map((t) => ({
          title: prefix + t.title,
          description: t.description,
          location: calNameById.get(0) ?? null,
          rrule: null,
          uid: `todo-${t.id}@local`,
          startTime: t.scheduled_start as string,
          endTime: t.scheduled_end as string,
        })),
    ];

    const ics = buildIcs(items);
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    downloadBlob(new Blob([ics], { type: 'text/calendar;charset=utf-8' }), `calendar-${stamp}.ics`);
  },

  // 导出周历 Excel：本地生成
  async exportWeek(lang: 'zh' | 'en' = 'zh'): Promise<void> {
    const { exportWeekLocally } = await import('./local-excel');
    const events = await offline.getEventCache();
    const todos = await offline.getCachedTodos();
    const calendars = await offline.getCalendarCache();
    await exportWeekLocally(events, todos, calendars, lang);
  },
};

// ---------- 排程：本地引擎优先，服务器仅作可选增强 ----------
export const scheduleApi = {
  async generate(mode: 'algorithm' | 'llm'): Promise<ScheduleResult> {
    const todos = await offline.getCachedTodos();
    const events = await offline.getEventCache();

    // LLM 模式：有服务器时由服务器代理调用；本机模式由 App 直连大模型
    if (mode === 'llm') {
      if (!isSyncEnabled()) {
        try {
          const local = await generateLLMScheduleLocally();
          return { mode: 'llm', ...local };
        } catch (err: any) {
          return {
            mode: 'llm',
            schedule: [],
            validation: { valid: false, errors: [err?.message || '本机大模型调度失败'] },
          };
        }
      }
      try {
        const res = await api.post('/schedule/generate', { mode });
        return normalizeScheduleResult(res.data);
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        return {
          mode: 'llm',
          schedule: [],
          validation: { valid: false, errors: ['无法连接服务器，请改用算法调度'] },
        };
      }
    }

    const schedule = generateScheduleLocally(todos, events);
    const validation = validateScheduleLocally(schedule, todos);
    return { mode: 'algorithm', schedule, validation };
  },

  async apply(schedule: ScheduleResult['schedule']): Promise<{ success: boolean; applied_count: number }> {
    const events = await offline.getEventCache();
    const validation = validateScheduleLocally(schedule, await offline.getCachedTodos());
    if (!validation.valid && validation.errors.some((e) => e.startsWith('时间冲突'))) {
      throw new Error(validation.errors.join('；'));
    }

    if (isSyncEnabled() && offline.isOnline()) {
      try {
        const res = await api.post('/schedule/apply', { schedule });
        // 服务器已应用：拉取最新数据覆盖本地
        const [todos, evts] = await Promise.all([
          serverApi.todos.getAll(),
          serverApi.events.getAll(),
        ]);
        await offline.saveCachedTodos(todos);
        await offline.saveEventCache(evts);
        setOfflineMode(false);
        return res.data;
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        setOfflineMode(true);
      }
    }

    // 本地应用：写入本地待办
    const todos = await offline.getCachedTodos();
    const groups = new Map<number, typeof schedule>();
    for (const item of schedule) {
      if (!groups.has(item.todo_id)) groups.set(item.todo_id, []);
      groups.get(item.todo_id)!.push(item);
    }

    let idCursor = nextIdFrom(todos) + 1;
    for (const [todoId, items] of groups) {
      const idx = todos.findIndex((t) => t.id === todoId);
      if (idx < 0) continue;
      const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));

      todos[idx] = {
        ...todos[idx],
        status: 'scheduled',
        scheduled_start: sorted[0].start,
        scheduled_end: sorted[0].end,
      };

      for (let i = 1; i < sorted.length; i++) {
        const base = todos[idx];
        const mins = Math.round(
          (new Date(sorted[i].end).getTime() - new Date(sorted[i].start).getTime()) / 60000
        );
        todos.push({
          ...base,
          id: idCursor++,
          title: `${base.title.replace(/\s*\(\d+\/\d+\)$/, '')} (${i + 1}/${sorted.length})`,
          estimated_minutes: mins,
          status: 'scheduled',
          scheduled_start: sorted[i].start,
          scheduled_end: sorted[i].end,
        });
      }
    }

    await offline.saveCachedTodos(todos);
    void events;
    notifyDataChanged();
    return { success: true, applied_count: schedule.length };
  },
};

// 排程结果来自服务端；非结构化响应（HTML 错误页等）在这里归一，避免渲染期访问 .schedule 崩溃
function normalizeScheduleResult(data: any): ScheduleResult {
  const schedule = Array.isArray(data?.schedule) ? data.schedule : [];
  const errors = Array.isArray(data?.validation?.errors) ? data.validation.errors : [];
  return {
    mode: data?.mode === 'llm' ? 'llm' : 'algorithm',
    schedule,
    validation: { valid: data?.validation?.valid === true && errors.length === 0, errors },
  };
}

// ---------- LLM 配置与提示词模板：仅服务器模式可用 ----------
export const llmConfigApi = {
  getAll: () => api.get<unknown>('/schedule/llm-config')
    .then(r => offline.requireArray<LLMConfig>(r.data, 'GET /schedule/llm-config')),
  create: (data: { provider: string; api_key?: string; base_url?: string; model?: string }) =>
    api.post('/schedule/llm-config', data).then(r => r.data),
  activate: (id: number) => api.put(`/schedule/llm-config/${id}/activate`).then(r => r.data),
  delete: (id: number) => api.delete(`/schedule/llm-config/${id}`).then(r => r.data),
  test: (data: { id?: number; provider?: string; api_key?: string; base_url?: string; model?: string }) =>
    api.post<{ success: boolean; message: string; model?: string }>('/schedule/llm-config/test', data).then(r => r.data),
  /**
   * 拉取服务商的可用模型列表，供设置页下拉选择。
   * 超时压到 12s：拿不到就尽快交给 App 直连兜底，不让用户干等 30s。
   */
  listModels: (data: { id?: number; provider?: string; api_key?: string; base_url?: string }) =>
    api.post<ModelListResult>('/schedule/llm-config/models', data, { timeout: 12000 })
      .then(r => r.data),
};

export const promptTemplateApi = {
  get: () =>
    api.get<{ template: string; defaultTemplate: string }>('/schedule/prompt-template').then(r => r.data),
  update: (template: string) =>
    api.put('/schedule/prompt-template', { template }).then(r => r.data),
  reset: () =>
    api.post<{ success: boolean; defaultTemplate: string }>('/schedule/prompt-template/reset').then(r => r.data),
};

export const settingsApi = {
  get: (key: string) =>
    api.get<{ key: string; value: string }>(`/settings/${key}`).then(r => r.data),
  set: (key: string, value: string) =>
    api.put(`/settings/${key}`, { value }).then(r => r.data),
};
