import axios from 'axios';
import type { Calendar, CalendarEvent, Todo, ScheduleResult, LLMConfig } from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

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
    api.get('/calendar/export-week', { responseType: 'blob' }).then(r => {
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
};

export const todoApi = {
  getAll: (params?: { status?: string; priority?: string }) =>
    api.get<Todo[]>('/todos', { params }).then(r => r.data),
  create: (data: Partial<Todo>) => api.post<Todo>('/todos', data).then(r => r.data),
  update: (id: number, data: Partial<Todo>) => api.put<Todo>(`/todos/${id}`, data).then(r => r.data),
  delete: (id: number) => api.delete(`/todos/${id}`).then(r => r.data),
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
};
