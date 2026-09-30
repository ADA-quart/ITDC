// 本机模式下的大模型排程：App 自己组装提示词、直接调服务商、自己校验结果。
//
// 提示词与解析规则来自 shared/llm-prompt.ts，与服务端代理完全同源；
// 数据取自 IndexedDB 缓存，因此不联网也能读数据（只有调用大模型那一步需要网络）。
import type { CalendarEvent, Priority, ScheduledItem, Todo } from '../types';
import * as offline from './offline';
import { buildUserPrompt, parseScheduleResponse, renderSystemPrompt } from '../../shared/llm-prompt';
import { validateScheduleLocally } from './local-scheduler';
import { chatLocal } from './llm-local';
import { getActiveLocalConfig, getLocalPromptTemplate } from './llm-config-local';

const HORIZON_DAYS = 45;
const MAX_EVENTS = 100;
const MAX_SCHEDULED_TODOS = 50;

/** 与服务端 buildPrompt 的取数口径保持一致，避免两种模式排出不同结果 */
function selectPromptData(todos: Todo[], events: CalendarEvent[], now: Date) {
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);

  const upcomingEvents = events
    .filter((e) => new Date(e.start_time) < horizon)
    .sort((a, b) => b.start_time.localeCompare(a.start_time))
    .slice(0, MAX_EVENTS)
    .map((e) => ({
      title: e.title,
      start_time: e.start_time,
      end_time: e.end_time,
      rrule: e.rrule,
    }));

  const scheduledTodos = todos
    .filter((t) => t.status === 'scheduled' && t.scheduled_start)
    .sort((a, b) => (b.scheduled_start || '').localeCompare(a.scheduled_start || ''))
    .slice(0, MAX_SCHEDULED_TODOS)
    .map((t) => ({ title: t.title, scheduled_start: t.scheduled_start, scheduled_end: t.scheduled_end }));

  const pendingTodos = todos
    .filter((t) => t.status === 'pending')
    .map((t) => ({
      id: t.id,
      title: t.title,
      estimated_minutes: t.estimated_minutes,
      priority: t.priority,
      deadline: t.deadline,
    }));

  return { events: upcomingEvents, scheduledTodos, pendingTodos };
}

export async function generateLLMScheduleLocally(): Promise<{
  schedule: ScheduledItem[];
  validation: { valid: boolean; errors: string[] };
}> {
  const config = await getActiveLocalConfig();
  if (!config) {
    throw new Error('本机模式还没有配置大模型：请到「设置 → LLM 服务配置」添加一个');
  }

  const [todos, events, template] = await Promise.all([
    offline.getCachedTodos(),
    offline.getEventCache(),
    getLocalPromptTemplate(),
  ]);

  const now = new Date();
  const data = selectPromptData(todos, events, now);
  const content = await chatLocal(config, [
    { role: 'system', content: renderSystemPrompt(template, now.toISOString()) },
    { role: 'user', content: buildUserPrompt(data) },
  ]);

  const parsed = parseScheduleResponse(content);
  const byId = new Map(todos.map((t) => [t.id, t]));

  const schedule: ScheduledItem[] = parsed.map((item) => {
    const start = new Date(item.start);
    const end = new Date(item.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error(`大模型返回了无效的时间格式: start=${item.start}, end=${item.end}`);
    }
    const todo = byId.get(item.todo_id);
    return {
      todo_id: item.todo_id,
      title: todo?.title || `待办 #${item.todo_id}`,
      start: start.toISOString(),
      end: end.toISOString(),
      priority: (todo?.priority || 'normal') as Priority,
    };
  });

  return { schedule, validation: validateScheduleLocally(schedule, todos) };
}
