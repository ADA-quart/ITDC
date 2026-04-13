import axios from 'axios';
import { message } from 'antd';
import type { Calendar, CalendarEvent, Todo, ScheduleResult, LLMConfig } from '../types';

const api = axios.create({
  baseURL: '/api',
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

export const calendarApi = {
  getAll: () => api.get<Calendar[]>('/calendar/calendars').then(r => r.data),
  create: (data: Partial<Calendar>) => api.post<Calendar>('/calendar/calendars', data).then(r => r.data),
  delete: (id: number) => api.delete(`/calendar/calendars/${id}`).then(r => r.data),
  getEvents: (start?: string, end?: string) =>
    api.get<CalendarEvent[]>('/calendar/events', { params: { start, end } }).then(r => r.data),
  createEvent: (data: Partial<CalendarEvent>) => api.post<CalendarEvent>('/calendar/events', data).then(r => r.data),
  updateEvent: (id: number, data: Partial<CalendarEvent>) => api.put<CalendarEvent>(`/calendar/events/${id}`, data).then(r => r.data),
  deleteEvent: (id: number) => api.delete(`/calendar/events/${id}`).then(r => r.data),
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

export const todoApi = {
  getAll: (params?: { status?: string; priority?: string }) =>
    api.get<Todo[]>('/todos', { params }).then(r => r.data),
  create: (data: Partial<Todo>) => api.post<Todo>('/todos', data).then(r => r.data),
  update: (id: number, data: Partial<Todo>) => api.put<Todo>(`/todos/${id}`, data).then(r => r.data),
  delete: (id: number) => api.delete(`/todos/${id}`).then(r => r.data),
  split: (id: number, segments: { start: string; end: string }[]) =>
    api.post<Todo>(`/todos/${id}/split`, { segments }).then(r => r.data),
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
