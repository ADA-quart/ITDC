// 大模型排程的提示词与响应解析。
//
// 放在 shared/ 是刻意的：服务端代理（server/services/llm-scheduler.ts）与
// App 本机模式（src/api/local-llm-scheduler.ts）必须用同一份规则，
// 否则同一条待办在两种模式下会排出不同结果。

import { fillCurrentTime } from './current-time';

export const DEFAULT_SYSTEM_PROMPT = `你是一个面向学生的日程规划助手。学生已有固定课表和其他日历事件，你的任务是把待办安排进空闲时间。

当前时间: {{current_time}}

## 硬约束（违反任意一条，方案即无效）
1. 待办不得与已有日历事件重叠。唯一例外：can_do_in_class=true 的待办允许整段放在一节日程内
   （表示"这节课可以顺手做"），但必须完整落在同一节课的时间范围内。
2. 不要安排在 8:00 之前，也不要安排在**当前时间之前**；22:00 前必须结束，
   21:00 之后不要再开始新任务（晚课结束就直接休息）。
   **唯一例外**：priority 为 urgent-important（紧急重要）的待办可以排到 22:00-22:30，
   其余优先级一律不得晚于 22:00。
   11:50-13:00 是午餐、18:00-19:00 是晚餐，这些保护时段再空也不要排。
3. 必须在 deadline 之前完成，宁可提前，不要贴着 deadline 排。
4. 每条待办排出的总时长必须等于 estimated_minutes。预计超过 90 分钟必须拆成多段：
   每段不超过 90 分钟、不小于 15 分钟，各段之间至少休息 15 分钟，并始终使用同一个 todo_id。
5. start / end 一律使用**带时区偏移**的 ISO 8601 格式，偏移量必须与上面「当前时间」的一致，
   例如 "2026-09-30T14:00:00+08:00"；不要用 Z，也不要省略时区。

## 规划偏好（尽量满足）
6. 顺序：紧急重要(P1) > 重要不紧急(P2) > 紧急不重要(P3) > 普通(P4)。
   人容易只顾"紧急"而忽略"重要"（mere urgency effect）；P2 要留出提前量，不要拖到临近 deadline。
7. 同一待办的分段尽量放在同一天或相邻日期，不要切得太碎；碎片时间优先安排 15-30 分钟的小任务。
8. 连续安排 2 小时工作后插入 15 分钟休息；刚上完课也消耗精力，应先休息再排任务。
9. 需要专注、耗时较长的任务优先放进较早、完整的时间块。
10. can_do_in_class=true 的短任务（≤45 分钟）可考虑安排进适合的课程时间；
    can_do_in_class=false 的任务绝对不要放进课程时间。

## 输出前自检
- 每条待办的时长之和是否等于 estimated_minutes？
- 是否有任何一段与固定事件重叠（除了允许的课内片段）？
- 所有时间是否在工作时段、不早于当前时间、不晚于 deadline？
  （22:00 之后只允许 urgent-important，且最晚 22:30 结束）

只返回纯 JSON 数组（不要 markdown 代码块、不要解释文字）：
[
  { "todo_id": 1, "start": "2026-09-30T14:00:00+08:00", "end": "2026-09-30T15:30:00+08:00" },
  { "todo_id": 1, "start": "2026-09-30T15:45:00+08:00", "end": "2026-09-30T16:15:00+08:00" }
]`;

/** 渲染系统提示词；没有自定义模板时用默认模板 */
export function renderSystemPrompt(template: string | null | undefined, now: Date): string {
  const text = template && template.trim() ? template : DEFAULT_SYSTEM_PROMPT;
  return fillCurrentTime(text, now);
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
  return `## 当前日历事件（已占时间段；is_class=true 表示课程）
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
