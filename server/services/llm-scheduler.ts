import db from '../db/index.js';
import { LLMProvider, LLMConfig } from '../llm/provider.js';
import { createProvider } from '../llm/index.js';
import { ScheduledItem } from './scheduler.js';
import { decrypt, isEncrypted } from '../utils/crypto.js';
import { debug } from '../utils/debug.js';
import {
  DEFAULT_SYSTEM_PROMPT,
  renderSystemPrompt,
  buildUserPrompt,
  parseScheduleResponse,
} from '../../shared/llm-prompt.js';

// 提示词是服务端与本机模式共用的，从 shared/ 转出，避免两处各写一份规则
export { DEFAULT_SYSTEM_PROMPT };


/**
 * Unified: decrypt the key in the config and create the corresponding LLM provider.
 */
function createProviderFromDb(config: LLMConfig & { api_key: string }): LLMProvider | null {
  let apiKey = config.api_key;
  if (apiKey && isEncrypted(apiKey)) {
    try {
      apiKey = decrypt(apiKey);
    } catch {
      console.error('API Key decryption failed, using the original value');
    }
  }

  return createProvider({
    provider: config.provider,
    base_url: config.base_url ?? null,
    model: config.model ?? null,
    api_key: apiKey || null,
  });
}

export function getActiveProvider(): LLMProvider | null {
  const config = db.prepare('SELECT * FROM llm_config WHERE is_active = 1').get() as (LLMConfig & { api_key: string; base_url: string; model: string }) | undefined;
  if (!config) return null;

  return createProviderFromDb(config);
}

export function getProviderForConfig(config: LLMConfig & { api_key: string }): LLMProvider | null {
  return createProviderFromDb(config);
}
function getPromptTemplate(): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'llm_prompt_template'").get() as { value: string } | undefined;
  return row?.value || '';
}

function buildPrompt(): { system: string; user: string } {
  const now = new Date().toISOString();
  const scheduleHorizon = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString();
  const events = db.prepare(
    'SELECT title, start_time, end_time, rrule FROM events WHERE start_time < ? ORDER BY start_time DESC LIMIT 100'
  ).all(scheduleHorizon);
  const scheduledTodos = db.prepare(
    "SELECT title, scheduled_start, scheduled_end FROM todos WHERE status = 'scheduled' AND scheduled_start IS NOT NULL ORDER BY scheduled_start DESC LIMIT 50"
  ).all();
  const pendingTodos = db.prepare(
    "SELECT id, title, estimated_minutes, priority, deadline FROM todos WHERE status = 'pending'"
  ).all();

  return {
    system: renderSystemPrompt(getPromptTemplate(), now),
    user: buildUserPrompt({ events, scheduledTodos, pendingTodos }),
  };
}

export { buildPrompt };

function validateSchedule(items: ScheduledItem[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const events = db.prepare('SELECT start_time, end_time FROM events').all() as { start_time: string; end_time: string }[];
  const scheduledTodos = db.prepare(
    "SELECT scheduled_start, scheduled_end FROM todos WHERE status = 'scheduled' AND scheduled_start IS NOT NULL"
  ).all() as { scheduled_start: string; scheduled_end: string }[];

  const allBusy = [
    ...events.map(e => ({ start: new Date(e.start_time), end: new Date(e.end_time) })),
    ...scheduledTodos.map(t => ({ start: new Date(t.scheduled_start!), end: new Date(t.scheduled_end!) })),
  ];

  for (const item of items) {
    const todo = db.prepare('SELECT id, title FROM todos WHERE id = ?').get(item.todo_id) as { id: number; title: string } | undefined;
    if (!todo) {
      errors.push(`待办 ${item.title} 的 todo_id (${item.todo_id}) 不存在`);
      continue;
    }

    const itemStart = new Date(item.start);
    const itemEnd = new Date(item.end);

    const startHour = itemStart.getHours();
    if (startHour >= 23 || startHour < 7) {
      errors.push(`待办 "${item.title}" 被安排在深夜时段`);
    }

    for (const busy of allBusy) {
      if (itemStart < busy.end && itemEnd > busy.start) {
        errors.push(`待办 "${item.title}" 与已有事件时间冲突`);
        break;
      }
    }

    const todoRow = db.prepare('SELECT deadline FROM todos WHERE id = ?').get(item.todo_id) as { deadline: string | null } | undefined;
    if (todoRow?.deadline && itemEnd > new Date(todoRow.deadline)) {
      errors.push(`待办 "${item.title}" 超过了截止时间`);
    }

    allBusy.push({ start: itemStart, end: itemEnd });
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const aStart = new Date(a.start);
      const aEnd = new Date(a.end);
      const bStart = new Date(b.start);
      const bEnd = new Date(b.end);
      if (aStart < bEnd && aEnd > bStart) {
        errors.push(`待办 "${a.title}" 和 "${b.title}" 时间冲突`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function generateLLMSchedule(): Promise<{ schedule: ScheduledItem[]; validation: { valid: boolean; errors: string[] } }> {
  const provider = getActiveProvider();
  if (!provider) {
    throw new Error('未配置 LLM 服务，请在设置中配置后再试');
  }

  const { system, user } = buildPrompt();

  debug.info('LLM schedule request sent');

  const response = await provider.chat([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);

  debug.info('LLM response received', { length: response.content.length });

  const parsed = parseScheduleResponse(response.content);

  const todos = db.prepare("SELECT id, title, priority FROM todos WHERE status = 'pending'").all() as { id: number; title: string; priority: string }[];
  const schedule: ScheduledItem[] = parsed.map((item: any) => {
    const todo = todos.find(t => t.id === item.todo_id);

    const start = new Date(item.start);
    const end = new Date(item.end);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error(`LLM 返回了无效的时间格式: start=${item.start}, end=${item.end}`);
    }

    return {
      todo_id: item.todo_id,
      title: todo?.title || `待办 #${item.todo_id}`,
      start: start.toISOString(),
      end: end.toISOString(),
      priority: todo?.priority || 'normal',
    };
  });

  const validation = validateSchedule(schedule);

  return { schedule, validation };
}
