import db from '../db/index.js';
import { getActiveProvider } from './llm-scheduler.js';
import { debug } from '../utils/debug.js';
import type { LLMProvider } from '../llm/provider.js';

export interface ParsedTodo {
  title: string;
  urgency: number; // 1-4
  importance: number; // 1-4
  priority: string;
  deadline: string | null;
  estimated_minutes: number;
}

const SYSTEM_PROMPT = `
你是一个待办事项解析助手。用户会用自然语言描述一个待办，请将其解析为结构化 JSON。

严格规则：
1. 只返回纯 JSON 对象，不要 markdown 代码块、不要解释文字
2. title: 提炼出的任务标题（简洁，不带时间信息）
3. urgency (紧急度, 1-4): 有明确近期截止时间或"马上/立刻/今天"等措辞 -> 3 或 4；无紧迫感 -> 1-2
4. importance (重要度, 1-4): 与工作成果、财务、健康相关且后果严重 -> 3-4；一般事务 -> 1-2
5. deadline: 解析出明确的截止日期/时间。"周五下午"按当前日期推断为最近一个周五的 18:00，格式 "YYYY-MM-DDTHH:mm:ss"（本地时间）；无法确定则 null
6. estimated_minutes: 根据任务复杂度估计所需分钟数（默认 30-120），取整数

JSON 结构：
{
  "title": "string",
  "urgency": number,
  "importance": number,
  "deadline": "YYYY-MM-DDTHH:mm:ss" | null,
  "estimated_minutes": number
}
`;

function priorityFrom(u: number, i: number): string {
  if (u >= 3 && i >= 3) return 'urgent-important';
  if (i >= 3) return 'important';
  if (u >= 3) return 'urgent';
  return 'normal';
}

function stripCodeFence(raw: string): string {
  let s = raw.trim();
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) s = fenceMatch[1];
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return s.trim();
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

async function parseLLMResponse(provider: LLMProvider, raw: string): Promise<ParsedTodo> {
  let parsed;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch (e) {
    throw new Error('解析失败：模型返回了无效的 JSON。请换一种说法再试。');
  }

  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  if (!title) {
    throw new Error('解析失败：未能识别任务标题。');
  }

  const urgency = clamp(parsed.urgency ?? 2, 1, 4);
  const importance = clamp(parsed.importance ?? 2, 1, 4);

  let deadline: string | null = null;
  if (typeof parsed.deadline === 'string' && parsed.deadline.trim()) {
    const d = new Date(parsed.deadline);
    if (!Number.isNaN(d.getTime())) {
      const now = Date.now();
      const futureOk = d.getTime() > now - 5 * 60 * 1000;
      const notTooFar = d.getTime() < now + 365 * 24 * 60 * 60 * 1000;
      if (futureOk && notTooFar) deadline = parsed.deadline.trim();
    }
  }

  const estimated_minutes = clamp(parsed.estimated_minutes ?? 60, 5, 720);

  return {
    title,
    urgency,
    importance,
    priority: priorityFrom(urgency, importance),
    deadline,
    estimated_minutes,
  };
}

export async function parseNaturalLanguageTodo(text: string): Promise<ParsedTodo> {
  const provider = getActiveProvider();
  if (!provider) {
    throw new Error('LLM 尚未配置：请在设置中启用一个 LLM 服务商后再使用自然语言录入。');
  }

  const nowIso = new Date().toISOString();
  debug.info('NL todo parse', { text: text.slice(0, 80), length: text.length });

  const response = await provider.chat([
    { role: 'system', content: SYSTEM_PROMPT.replace('{{current_time}}', nowIso) },
    { role: 'user', content: '请解析这条待办描述：' + text },
  ]);

  return parseLLMResponse(provider, response.content);
}
