// 大模型排程的提示词与响应解析。
//
// 放在 shared/ 是刻意的：服务端代理（server/services/llm-scheduler.ts）与
// App 本机模式（src/api/local-llm-scheduler.ts）必须用同一份规则，
// 否则同一条待办在两种模式下会排出不同结果。

export const DEFAULT_SYSTEM_PROMPT = `你是一个日程规划助手。根据以下信息，为待办事件安排最优时间。

当前时间: {{current_time}}

## 规则
1. 待办事件不能与已有日历事件时间冲突
2. 不要安排在深夜 (23:00-7:00)
3. 优先安排距 deadline 最近的任务
4. 高优先级任务应尽早安排（紧急重要 > 重要 > 紧急 > 普通）
5. 连续工作 2 小时后建议安排 15 分钟休息
6. 每个待办事件需要指定的分钟数完成
7. 如果一个待办事件预计时间超过 90 分钟，必须拆分成多个不超过 90 分钟的时间段，每段之间安排 15 分钟休息。拆分后的多个时间段使用相同的 todo_id 标识

请以纯 JSON 数组格式返回调度方案（不要包含 markdown 代码块标记）：
[{ "todo_id": number, "start": "ISO datetime", "end": "ISO datetime" }]`;

/** 把 {{current_time}} 占位符替换成当前时间；没有自定义模板时用默认模板 */
export function renderSystemPrompt(template: string | null | undefined, nowIso: string): string {
  const text = template && template.trim() ? template : DEFAULT_SYSTEM_PROMPT;
  return text.replace(/\{\{current_time\}\}/g, nowIso);
}

export interface PromptPayload {
  /** 已占用的日历事件 */
  events: unknown[];
  /** 已经安排过时间的待办 */
  scheduledTodos: unknown[];
  /** 待安排的待办 */
  pendingTodos: unknown[];
}

export function buildUserPrompt(payload: PromptPayload): string {
  return `## 当前日历事件（已占时间段）
${JSON.stringify(payload.events, null, 2)}

## 已安排的待办
${JSON.stringify(payload.scheduledTodos, null, 2)}

## 待安排的待办事件
${JSON.stringify(payload.pendingTodos, null, 2)}`;
}

export interface RawScheduleItem {
  todo_id: number;
  start: string;
  end: string;
}

/**
 * 解析模型返回的排程数组。
 * 模型经常把 JSON 包在 ```json 代码块或解释性文字里，所以先夹取方括号内容再解析。
 */
export function parseScheduleResponse(content: string): RawScheduleItem[] {
  let text = (content || '').trim();
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (jsonMatch) text = jsonMatch[0];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('大模型返回的格式无法解析，请重试');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('大模型返回的格式无法解析，请重试');
  }
  return parsed as RawScheduleItem[];
}
