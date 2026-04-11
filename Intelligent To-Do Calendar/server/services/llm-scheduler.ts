import db from '../db/index.js';
import { LLMProvider, LLMConfig } from '../llm/provider.js';
import { createOpenAIProvider } from '../llm/openai-compatible.js';
import { createDeepSeekProvider } from '../llm/openai-compatible.js';
import { OllamaProvider } from '../llm/ollama.js';
import { ScheduledItem } from './scheduler.js';
import { decrypt, isEncrypted } from '../utils/crypto.js';

function getActiveProvider(): LLMProvider | null {
  const config = db.prepare('SELECT * FROM llm_config WHERE is_active = 1').get() as (LLMConfig & { api_key: string; base_url: string; model: string }) | undefined;
  if (!config) return null;

  // 解密 API Key（兼容旧版明文存储）
  let apiKey = config.api_key;
  if (apiKey && isEncrypted(apiKey)) {
    try {
      apiKey = decrypt(apiKey);
    } catch {
      console.error('API Key 解密失败，将使用原始值');
    }
  }

  switch (config.provider) {
    case 'openai':
      return createOpenAIProvider(apiKey, config.base_url || undefined, config.model || undefined);
    case 'deepseek':
      return createDeepSeekProvider(apiKey, config.base_url || undefined, config.model || undefined);
    case 'ollama':
      return new OllamaProvider(config.base_url || undefined, config.model || undefined);
    default:
      return null;
  }
}

function buildPrompt(): { system: string; user: string } {
  const now = new Date().toISOString();
  const events = db.prepare('SELECT title, start_time, end_time, rrule FROM events').all();
  const scheduledTodos = db.prepare(
    "SELECT title, scheduled_start, scheduled_end FROM todos WHERE status = 'scheduled' AND scheduled_start IS NOT NULL"
  ).all();
  const pendingTodos = db.prepare(
    "SELECT id, title, estimated_minutes, priority, deadline FROM todos WHERE status = 'pending'"
  ).all();

  const systemPrompt = `你是一个日程规划助手。根据以下信息，为待办事件安排最优时间。

当前时间: ${now}

## 规则
1. 待办事件不能与已有日历事件时间冲突
2. 不要安排在深夜 (23:00-7:00)
3. 优先安排距 deadline 最近的任务
4. 高优先级任务应尽早安排（紧急重要 > 重要 > 紧急 > 普通）
5. 连续工作 2 小时后建议安排 15 分钟休息
6. 每个待办事件需要指定的分钟数完成

请以纯 JSON 数组格式返回调度方案（不要包含 markdown 代码块标记）：
[{ "todo_id": number, "start": "ISO datetime", "end": "ISO datetime" }]`;

  const userPrompt = `## 当前日历事件（已占时间段）
${JSON.stringify(events, null, 2)}

## 已安排的待办
${JSON.stringify(scheduledTodos, null, 2)}

## 待安排的待办事件
${JSON.stringify(pendingTodos, null, 2)}`;

  return { system: systemPrompt, user: userPrompt };
}

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

    const todo = db.prepare('SELECT deadline FROM todos WHERE id = ?').get(item.todo_id) as { deadline: string | null } | undefined;
    if (todo?.deadline && itemEnd > new Date(todo.deadline)) {
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

  const response = await provider.chat([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);

  let parsed: any[];
  try {
    let content = response.content.trim();
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      content = jsonMatch[0];
    }
    parsed = JSON.parse(content);
  } catch {
    throw new Error('LLM 返回的格式无法解析，请重试');
  }

  const todos = db.prepare("SELECT id, title, priority FROM todos WHERE status = 'pending'").all() as { id: number; title: string; priority: string }[];
  const schedule: ScheduledItem[] = parsed.map((item: any) => {
    const todo = todos.find(t => t.id === item.todo_id);

    // 校验 LLM 返回的时间格式是否为有效的 ISO datetime
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
