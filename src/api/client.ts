import axios from 'axios';
import { message } from 'antd';
import type { Calendar, CalendarEvent, Todo, ScheduleResult, LLMConfig } from '../types';
import * as offline from './offline';

const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE || "/api";
function resolveApiBase(): string {
  try {
    return localStorage.getItem("itdc_api_base") ?? DEFAULT_API_BASE;
  } catch {
    return DEFAULT_API_BASE;
  }
}
const api = axios.create({
  baseURL: resolveApiBase(),
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
      // 网络断开或服务器未启动
      message.error('网络连接失败，请检查服务是否启动');
    } else if (status && status >= 500) {
      message.error(serverMessage || '服务器内部错误，请稍后重试');
    }

    return Promise.reject(error);
  }
);

// For settings page, switchable server address (used when connecting to local service from mobile)
function setApiBase(url: string): void {
  try {
    localStorage.setItem("itdc_api_base", url);
  } catch {
  }
  api.defaults.baseURL = url;

}
// Get current API base, for display on the settings page
function getApiBase(): string {
  return (api.defaults.baseURL as string) || DEFAULT_API_BASE;
}


export { api, setApiBase, getApiBase };

// ---------- 日历原始网络 API（flushQueue 内部使用） ----------
const networkCalendarApi = {
  getAll: () => api.get<Calendar[]>('/calendar/calendars').then(r => r.data),
  create: (data: Partial<Calendar>) => api.post<Calendar>('/calendar/calendars', data).then(r => r.data),
  delete: (id: number) => api.delete(`/calendar/calendars/${id}`).then(r => r.data),
  getEvents: () => api.get<CalendarEvent[]>('/calendar/events').then(r => r.data),
  createEvent: (data: Partial<CalendarEvent>) => api.post<CalendarEvent>('/calendar/events', data).then(r => r.data),
  updateEvent: (id: number, data: Partial<CalendarEvent>) => api.put<CalendarEvent>(`/calendar/events/${id}`, data).then(r => r.data),
  deleteEvent: (id: number) => api.delete(`/calendar/events/${id}`).then(r => r.data),
};

// ---------- 日历离线层：断网时缓存读取 + 本地模拟 + 队列同步 ----------
export const calendarApi = {
  async getAll(): Promise<Calendar[]> {
    if (offline.isOnline()) {
      try {
        const data = await networkCalendarApi.getAll();
        await offline.saveCalendarCache(data);
        setOfflineMode(false);
        return data;
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        // 网络断开 → 回退本地缓存
        const cached = await offline.getCalendarCache();
        if (cached.length > 0) {
          setOfflineMode(true);
          message.warning('当前离线，显示本地缓存的日历');
          return cached;
        }
        throw err;
      }
    } else {
      // 明确离线（navigator.onLine=false）：直接读缓存
      const cached = await offline.getCalendarCache();
      setOfflineMode(cached.length > 0);
      if (cached.length === 0) message.warning('当前离线，且没有本地日历数据');
      return cached;
    }
  },
  async create(data: Partial<Calendar>): Promise<Calendar> {
    if (offline.isOnline()) {
      const cal = await networkCalendarApi.create(data);
      // 服务器为权威：刷新本地缓存
      const cached = await offline.getCalendarCache();
      await offline.saveCalendarCache([...cached.filter(c => c.id !== cal.id), cal]);
      setOfflineMode(false);
      return cal;
    } else {
      // 离线：本地模拟创建，入队待同步（临时 ID）
      const cached = await offline.getCalendarCache();
      const local = offline.localCreateCalendar(data);
      await offline.saveCalendarCache([...cached, local]);
      await offline.enqueue({ op: 'create-calendar', data, ts: Date.now() });
      setOfflineMode(true);
      message.info('离线保存，联网后将自动同步');
      return local;
    }
  },
  async delete(id: number): Promise<any> {
    if (offline.isOnline()) {
      const res = await networkCalendarApi.delete(id);
      // 服务器为权威：刷新本地缓存
      const cached = await offline.getCalendarCache();
      await offline.saveCalendarCache(cached.filter(c => c.id !== id));
      setOfflineMode(false);
      return res;
    } else {
      // 离线：本地删除（连带事件），入队待同步
      const calC = await offline.getCalendarCache();
      const evC = await offline.getEventCache();
      const { calendars, events } = offline.localDeleteCalendar(calC, evC, id);
      await offline.saveCalendarCache(calendars);
      await offline.saveEventCache(events);
      await offline.enqueue({ op: 'delete-calendar', id, ts: Date.now() });
      setOfflineMode(true);
      message.info('离线删除，联网后将自动同步');
      return { success: true };
    }
  },
  async getEvents(): Promise<CalendarEvent[]> {
    if (offline.isOnline()) {
      try {
        const data = await networkCalendarApi.getEvents();
        await offline.saveEventCache(data);
        setOfflineMode(false);
        return data;
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        // 网络断开 → 回退本地缓存
        const cached = await offline.getEventCache();
        if (cached.length > 0) {
          setOfflineMode(true);
          message.warning('当前离线，显示本地缓存的事件');
          return cached;
        }
        throw err;
      }
    } else {
      // 明确离线：直接读缓存
      const cached = await offline.getEventCache();
      if (cached.length === 0) message.warning('当前离线，且没有本地事件数据');
      return cached;
    }
  },
  async createEvent(data: Partial<CalendarEvent>): Promise<CalendarEvent> {
    if (offline.isOnline()) {
      const evt = await networkCalendarApi.createEvent(data);
      // 服务器为权威：缓存中替换同 id 条目
      const cached = await offline.getEventCache();
      await offline.saveEventCache([...cached.filter(e => e.id !== evt.id), evt]);
      setOfflineMode(false);
      return evt;
    } else {
      // 离线：本地模拟创建，入队待同步（临时 ID）
      const cached = await offline.getEventCache();
      const local = offline.localCreateEvent(data);
      await offline.saveEventCache([...cached, local]);
      await offline.enqueue({ op: 'create-event', data, ts: Date.now() });
      setOfflineMode(true);
      message.info('离线保存，联网后将自动同步');
      return local;
    }
  },
  async updateEvent(id: number, data: Partial<CalendarEvent>): Promise<CalendarEvent> {
    if (offline.isOnline()) {
      const evt = await networkCalendarApi.updateEvent(id, data);
      // 服务器为权威：缓存中替换同 id 条目
      const cached = await offline.getEventCache();
      await offline.saveEventCache([...cached.filter(e => e.id !== evt.id), evt]);
      setOfflineMode(false);
      return evt;
    } else {
      // 离线：本地模拟更新，入队（flush 时因临时 ID 不匹配会跳过，重新拉取即可）
      const cached = await offline.getEventCache();
      await offline.saveEventCache(offline.localUpdateEvent(cached, id, data));
      await offline.enqueue({ op: 'update-event', id, data, ts: Date.now() });
      setOfflineMode(true);
      message.info('离线保存，联网后将自动同步');
      return cached.find(e => e.id === id) ?? { ...data } as CalendarEvent;
    }
  },
  async deleteEvent(id: number): Promise<any> {
    if (offline.isOnline()) {
      const res = await networkCalendarApi.deleteEvent(id);
      // 服务器为权威：刷新本地事件缓存
      const cached = await offline.getEventCache();
      await offline.saveEventCache(cached.filter(e => e.id !== id));
      setOfflineMode(false);
      return res;
    } else {
      // 离线：本地删除，入队待同步（临时 ID flush 时跳过）
      const cached = await offline.getEventCache();
      await offline.saveEventCache(offline.localDeleteEvent(cached, id));
      await offline.enqueue({ op: 'delete-event', id, ts: Date.now() });
      setOfflineMode(true);
      message.info('离线删除，联网后将自动同步');
      return { success: true };
    }
  },
  importIcs: (file: File, calendarName?: string, calendarColor?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (calendarName) formData.append('calendar_name', calendarName);
    if (calendarColor) formData.append('calendar_color', calendarColor);
    return api.post('/calendar/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data);
  },
  exportWeek: () =>
    api.get('/calendar/export-week', { responseType: 'blob', params: { lang: localStorage.getItem('locale') || 'zh' } }).then(r => {
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const link = document.createElement('a');
      const disposition = r.headers['content-disposition'];
      let filename = 'calendar-week.xlsx';
      if (disposition) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match) filename = match[1];
      }
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    }),
  exportIcal: () =>
    api.get('/calendar/export-ical', { responseType: 'blob', params: { lang: localStorage.getItem('locale') || 'zh' } }).then(r => {
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const link = document.createElement('a');
      const disposition = r.headers['content-disposition'];
      let filename = 'calendar.ics';
      if (disposition) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match) filename = match[1];
      }
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    }),
};


// ---------- 待办原始网络 API（flushQueue 内部使用） ----------
const networkTodoApi = {
  getAll: (params?: any) => api.get<Todo[]>('/todos', { params }).then(r => r.data),
  create: (data: Partial<Todo>) => api.post<Todo>('/todos', data).then(r => r.data),
  update: (id: number, data: Partial<Todo>) => api.put<Todo>(`/todos/${id}`, data).then(r => r.data),
  delete: (id: number) => api.delete(`/todos/${id}`).then(r => r.data),
  split: (id: number, segments: { start: string; end: string }[]) =>
    api.post<Todo>(`/todos/${id}/split`, { segments }).then(r => r.data),
  parseNL: (text: string) => api.post<Todo>('/todos/nl', { text }).then(r => r.data),
};

// ---------- 待办离线层：断网时缓存读取 + 本地模拟 + 队列同步 ----------
let offlineMode = false;
export function setOfflineMode(on: boolean) {
  if (offlineMode === on) return;
  offlineMode = on;
  window.dispatchEvent(new CustomEvent('todo-offline-mode', { detail: { mode: on } }));
}

function isNetworkError(err: any): boolean {
  // 网络层错误（无响应、超时、连接失败），而非服务端 4xx/5xx
  return !err?.response;
}

export const todoApi = {
  async getAll(params?: { status?: string; priority?: string }): Promise<Todo[]> {
    if (offline.isOnline()) {
      try {
        const data = await networkTodoApi.getAll(params);
        // 缓存服务器数据（注意：带 filter 时只缓存全量，避免过滤后缓存不完整）
        await offline.saveCachedTodos(data);
        setOfflineMode(false);
        return data;
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        // 网络断开 → 回退本地缓存
        const cached = await offline.getCachedTodos();
        if (cached.length > 0) {
          setOfflineMode(true);
          message.warning('当前离线，显示本地缓存数据');
          return cached;
        }
        throw err;
      }
    } else {
      // 明确离线（navigator.onLine=false）：直接读缓存
      const cached = await offline.getCachedTodos();
      setOfflineMode(cached.length > 0);
      if (cached.length === 0) {
        message.warning('当前离线，且没有本地数据');
      }
      return cached;
    }
  },

  async create(data: Partial<Todo>): Promise<Todo> {
    if (offline.isOnline()) {
      const todo = await networkTodoApi.create(data);
      setOfflineMode(false);
      return todo;
    } else {
      // 离线：本地模拟创建，入队待同步
      const todos = await offline.getCachedTodos();
      const local = offline.localCreate(data);
      await offline.saveCachedTodos([...todos, local]);
      await offline.enqueue({ op: 'create', data, ts: Date.now() });
      setOfflineMode(true);
      message.info('离线保存，联网后将自动同步');
      return local;
    }
  },

  async update(id: number, data: Partial<Todo>): Promise<Todo> {
    if (offline.isOnline()) {
      const todo = await networkTodoApi.update(id, data);
      setOfflineMode(false);
      return todo;
    } else {
      // 离线：本地模拟更新，入队待同步
      const todos = await offline.getCachedTodos();
      const idx = todos.findIndex((t) => t.id === id);
      if (idx >= 0) {
        todos[idx] = offline.localUpdate(todos[idx], data);
        await offline.saveCachedTodos(todos);
        await offline.enqueue({ op: 'update', id, data, ts: Date.now() });
        setOfflineMode(true);
        message.info('离线保存，联网后将自动同步');
      }
      return todos[idx]!;
    }
  },

  async delete(id: number): Promise<{ success: boolean }> {
    if (offline.isOnline()) {
      const res = await networkTodoApi.delete(id);
      setOfflineMode(false);
      return res;
    } else {
      // 离线：本地删除，入队待同步
      const todos = await offline.getCachedTodos();
      await offline.saveCachedTodos(offline.localDelete(todos, id));
      await offline.enqueue({ op: 'delete', id, ts: Date.now() });
      setOfflineMode(true);
      message.info('离线删除，联网后将自动同步');
      return { success: true };
    }
  },

  async split(id: number, segments: { start: string; end: string }[]): Promise<Todo> {
    if (offline.isOnline()) {
      const todo = await networkTodoApi.split(id, segments);
      setOfflineMode(false);
      return todo;
    } else {
      // 离线：本地模拟拆分，入队（flush 时因 ID 可能不匹配会跳过，重新拉取即可）
      const todos = await offline.getCachedTodos();
      const idx = todos.findIndex((t) => t.id === id);
      if (idx >= 0) {
        const replaced = offline.localSplit(todos[idx], segments);
        todos.splice(idx, 1, ...replaced);
        await offline.saveCachedTodos(todos);
        await offline.enqueue({ op: 'split', id, data: segments, ts: Date.now() });
        setOfflineMode(true);
        message.info('离线拆分，联网后将自动同步');
      }
      return todos[idx]!;
    }
  },

  parseNL: (text: string) => networkTodoApi.parseNL(text),
};
export const scheduleApi = {
  generate: (mode: 'algorithm' | 'llm') =>
    api.post<ScheduleResult>('/schedule/generate', { mode }).then(r => r.data),
  apply: (schedule: ScheduleResult['schedule']) =>
    api.post('/schedule/apply', { schedule }).then(r => r.data),
};

export const llmConfigApi = {
  getAll: () => api.get<LLMConfig[]>('/schedule/llm-config').then(r => r.data),
  create: (data: { provider: string; api_key?: string; base_url?: string; model?: string }) =>
    api.post('/schedule/llm-config', data).then(r => r.data),
  activate: (id: number) => api.put(`/schedule/llm-config/${id}/activate`).then(r => r.data),
  delete: (id: number) => api.delete(`/schedule/llm-config/${id}`).then(r => r.data),
  test: (data: { id?: number; provider?: string; api_key?: string; base_url?: string; model?: string }) =>
    api.post<{ success: boolean; message: string; model?: string }>('/schedule/llm-config/test', data).then(r => r.data),
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
