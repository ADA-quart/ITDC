// 自然语言待办解析的提示词与响应校验。
//
// 与服务端（server/services/nl-todo.ts）和 App 本机模式（src/api/local-nl-todo.ts）共用：
// 「周五下午」这类相对时间、紧急/重要度的判定规则必须一致，
// 否则同一条描述在两种模式下会得到不同的四象限归类。

export const NL_TODO_SYSTEM_PROMPT = `
你是一个待办事项解析助手。用户会用自然语言描述一个待办，请将其解析为结构化 JSON。

当前时间: {{current_time}}

严格规则：
1. 只返回纯 JSON 对象，不要 markdown 代码块、不要解释文字
2. title: 提炼出的任务标题（简洁，不带时间信息）
3. urgency (紧急度, 1-4): 有明确近期截止时间或"马上/立刻/今天"等措辞 -> 3 或 4；无紧迫感 -> 1-2
4. importance (重要度, 1-4): 与工作成果、财务、健康相关且后果严重 -> 3-4；一般事务 -> 1-2
5. deadline: 解析出明确的截止日期/时间。"周五下午"按当前日期推断为最近一个周五的 18:00，格式 "YYYY-MM-DDTHH:mm:ss"（本地时间）；无法确定则 null
6. estimated_minutes: 根据任务复杂度估计所需分钟数（默认 30-120），取整数
7. in_class (布尔值): 用户明确说"上课时可以做/课间可以做/水课可以做"-> true；否则一律 false

JSON 结构：
{
  "title": "string",
  "urgency": number,
  "importance": number,
  "deadline": "YYYY-MM-DDTHH:mm:ss" | null,
  "estimated_minutes": number,
  "in_class": boolean
}
`;

export interface ParsedTodo {
  title: string;
  urgency: number; // 1-4
  importance: number; // 1-4
  priority: string;
  deadline: string | null;
  estimated_minutes: number;
  /** 用户是否明确表示这条待办可以在上课时做 */
  in_class: boolean;
}

export function priorityFrom(urgency: number, importance: number): string {
  if (urgency >= 3 && importance >= 3) return 'urgent-important';
  if (importance >= 3) return 'important';
  if (urgency >= 3) return 'urgent';
  return 'normal';
}

/** 模型经常把 JSON 包在 ```json 代码块或解释文字里，先剥掉外层再解析 */
export function stripCodeFence(raw: string): string {
  let s = (raw || '').trim();
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

/**
 * 校验模型返回的 JSON。
 * 截止时间只接受「不太久远的未来」：模型偶尔会编出过去时间或几年后的日期，
 * 直接写库会让待办一创建就是逾期状态。
 */
export function parseTodoFromModel(raw: string): ParsedTodo {
  let parsed: any;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    throw new Error('解析失败：模型返回了无效的 JSON。请换一种说法再试。');
  }

  const title = typeof parsed?.title === 'string' ? parsed.title.trim() : '';
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
  const in_class = parsed?.in_class === true || parsed?.in_class === 'true';

  return {
    title,
    urgency,
    importance,
    priority: priorityFrom(urgency, importance),
    deadline,
    estimated_minutes,
    in_class,
  };
}
