import db from '../db/index.js';
import { LLMProvider, LLMConfig } from '../llm/provider.js';
import { createProvider } from '../llm/index.js';
import { ScheduledItem } from './scheduler.js';
import { looksLikeCourse } from '../../shared/cdut-parser.js';
import {
  WORK_START_HOUR,
  WORK_END_HOUR,
  LATE_START_HOUR,
  findProtectedWindow,
} from '../../shared/schedule-policy.js';
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
    thinking_effort: config.thinking_effort ?? null,
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
  const now = new Date();
  const scheduleHorizon = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString();
  const events = db.prepare(
    'SELECT title, start_time, end_time, rrule, source, location FROM events WHERE start_time < ? ORDER BY start_time DESC LIMIT 100'
  ).all(scheduleHorizon).map((e: any) => ({
    title: e.title,
    start_time: e.start_time,
    end_time: e.end_time,
    rrule: e.rrule,
    is_class: looksLikeCourse(e),
  }));
  const scheduledTodos = db.prepare(
    "SELECT title, scheduled_start, scheduled_end FROM todos WHERE status = 'scheduled' AND scheduled_start IS NOT NULL ORDER BY scheduled_start DESC LIMIT 50"
  ).all();
  const pendingTodos = db.prepare(
    "SELECT id, title, estimated_minutes, priority, deadline, can_do_in_class FROM todos WHERE status = 'pending'"
  ).all().map((t: any) => ({ ...t, can_do_in_class: !!t.can_do_in_class }));

  return {
    system: renderSystemPrompt(getPromptTemplate(), now),
    user: buildUserPrompt({ events, scheduledTodos, pendingTodos }),
  };
}

export { buildPrompt };

function validateSchedule(items: ScheduledItem[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const events = db.prepare('SELECT start_time, end_time, source, location FROM events').all() as {
    start_time: string;
    end_time: string;
    source: string | null;
    location: string | null;
  }[];
  const scheduledTodos = db.prepare(
    "SELECT scheduled_start, scheduled_end FROM todos WHERE status = 'scheduled' AND scheduled_start IS NOT NULL"
  ).all() as { scheduled_start: string; scheduled_end: string }[];

  const allBusy = [
    ...events.map(e => ({
      start: new Date(e.start_time),
      end: new Date(e.end_time),
      isClass: looksLikeCourse(e),
    })),
    ...scheduledTodos.map(t => ({
      start: new Date(t.scheduled_start!),
      end: new Date(t.scheduled_end!),
      isClass: false,
    })),
  ];
  const todoMinutes = new Map<number, number>();

  for (const item of items) {
    const todo = db.prepare(
      'SELECT id, title, estimated_minutes, deadline, can_do_in_class FROM todos WHERE id = ?'
    ).get(item.todo_id) as {
      id: number;
      title: string;
      estimated_minutes: number;
      deadline: string | null;
      can_do_in_class: number | null;
    } | undefined;
    if (!todo) {
      errors.push(`待办 ${item.title} 的 todo_id (${item.todo_id}) 不存在`);
      continue;
    }

    const itemStart = new Date(item.start);
    const itemEnd = new Date(item.end);

    const startMinutes = itemStart.getHours() * 60 + itemStart.getMinutes();
    const endMinutes = itemEnd.getHours() * 60 + itemEnd.getMinutes();
    if (startMinutes < WORK_START_HOUR * 60 || endMinutes > WORK_END_HOUR * 60) {
      errors.push(`待办 "${item.title}" 被安排在深夜时段`);
    } else if (startMinutes >= LATE_START_HOUR * 60) {
      errors.push(`待办 "${item.title}" 被安排在深夜时段`);
    }
    // 与本地校验保持一致：已经过去的时段写进库等于永远做不了
    if (itemEnd.getTime() < Date.now() - 5 * 60 * 1000) {
      errors.push(`待办 "${item.title}" 被安排在已过去的时间`);
    }
    const protectedWindow = findProtectedWindow(itemStart, itemEnd);
    if (protectedWindow) {
      errors.push(`待办 "${item.title}" 被安排在${protectedWindow.label}时段`);
    }
    const duration = Math.round((itemEnd.getTime() - itemStart.getTime()) / 60000);
    if (duration > 90) {
      errors.push(`待办 "${item.title}" 单段超过 90 分钟，需要继续拆分`);
    }
    todoMinutes.set(item.todo_id, (todoMinutes.get(item.todo_id) ?? 0) + duration);

    for (const busy of allBusy) {
      if (itemStart < busy.end && itemEnd > busy.start) {
        // 课内可做的待办允许整段落在同一节课里；其它任何重叠都无效
        const allowedInClass = !!todo.can_do_in_class && busy.isClass
          && itemStart >= busy.start && itemEnd <= busy.end;
        if (!allowedInClass) {
          errors.push(`待办 "${item.title}" 与已有事件时间冲突`);
          break;
        }
      }
    }

    if (todo.deadline && itemEnd > new Date(todo.deadline)) {
      errors.push(`待办 "${item.title}" 超过了截止时间`);
    }

    allBusy.push({ start: itemStart, end: itemEnd, isClass: false });
  }

  // 完成量校验：拆出的分段总和必须接近 estimated_minutes，避免"排了一半"
  for (const [todoId, minutes] of todoMinutes) {
    const todo = db.prepare('SELECT title, estimated_minutes FROM todos WHERE id = ?').get(todoId) as
      { title: string; estimated_minutes: number } | undefined;
    if (!todo) continue;
    if (minutes < todo.estimated_minutes - 5) {
      errors.push(`拆分不完整：待办 "${todo.title}" 只安排了 ${minutes} 分钟，预计需要 ${todo.estimated_minutes} 分钟`);
    } else if (minutes > todo.estimated_minutes + 5) {
      errors.push(`超出预计时长：待办 "${todo.title}" 安排了 ${minutes} 分钟，预计 ${todo.estimated_minutes} 分钟`);
    }
  }
  // 完全没排上的 pending 待办同样要提示，避免"生成成功"但漏掉任务
  const pendingTodos = db.prepare("SELECT id, title FROM todos WHERE status = 'pending'").all() as
    { id: number; title: string }[];
  for (const todo of pendingTodos) {
    if (!todoMinutes.has(todo.id)) errors.push(`未能安排：${todo.title}`);
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
