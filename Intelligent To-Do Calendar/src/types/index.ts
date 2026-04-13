export interface Calendar {
  id: number;
  name: string;
  color: string;
  source: string;
  created_at: string;
}

export interface CalendarEvent {
  id: number;
  calendar_id: number;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  rrule: string | null;
  location: string | null;
  source: string;
  uid: string | null;
  calendar_name?: string;
  calendar_color?: string;
  created_at: string;
}

export interface Todo {
  id: number;
  title: string;
  description: string | null;
  estimated_minutes: number;
  priority: Priority;
  urgency: number;
  importance: number;
  deadline: string | null;
  status: TodoStatus;
  scheduled_start: string | null;
  scheduled_end: string | null;
  color: string | null;
  created_at: string;
}

export type Priority = 'urgent-important' | 'important' | 'urgent' | 'normal';
export type TodoStatus = 'pending' | 'scheduled' | 'done';

export interface ScheduledItem {
  todo_id: number;
  title: string;
  start: string;
  end: string;
  priority: Priority;
}

export interface ScheduleResult {
  mode: 'algorithm' | 'llm';
  schedule: ScheduledItem[];
  validation: {
    valid: boolean;
    errors: string[];
  };
}

export interface LLMConfig {
  id: number;
  provider: 'openai' | 'deepseek' | 'ollama' | 'lmstudio' | 'custom';
  base_url?: string;
  model?: string;
  is_active: number;
  created_at: string;
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  'urgent-important': '紧急重要',
  'important': '重要不紧急',
  'urgent': '紧急不重要',
  'normal': '普通',
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  'urgent-important': '#f5222d',
  'important': '#fa8c16',
  'urgent': '#1890ff',
  'normal': '#52c41a',
};

export const TODO_PALETTE = [
  '#722ed1', '#13c2c2', '#eb2f96', '#fa8c16',
  '#52c41a', '#1890ff', '#f5222d', '#2f54eb',
  '#a0d911', '#fadb14', '#fa541c', '#9254de',
];
