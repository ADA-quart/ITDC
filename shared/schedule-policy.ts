/**
 * 排程时间策略：客户端算法、服务端算法、LLM 校验与提示词共用同一套口径，
 * 避免"算法避开午饭、LLM 却排到午饭"这类不一致。
 */

/** 不排早于 8:00 的任务：7 点排待办属于打扰而不是帮助 */
export const WORK_START_HOUR = 8;
export const WORK_END_HOUR = 23;
/** 两节课之间的空档小于这个值就不排任务（5/25 分钟课间不硬塞） */
export const MIN_USABLE_GAP_MINUTES = 30;
/** 任务结束到下一个日程之间至少留 5 分钟缓冲 */
export const SLOT_BUFFER_MINUTES = 5;

export interface ProtectedWindow {
  /** 分钟制起点（含） */
  start: number;
  /** 分钟制终点（不含） */
  end: number;
  label: string;
}

/** 吃饭/休息保护时段：这些时间再空也不自动排待办 */
export const PROTECTED_WINDOWS: readonly ProtectedWindow[] = [
  { start: 11 * 60 + 50, end: 13 * 60, label: '午餐' },
  { start: 18 * 60, end: 19 * 60, label: '晚餐' },
];

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** 返回与 [start, end) 重叠的保护时段；没有则 null */
export function findProtectedWindow(start: Date, end: Date): ProtectedWindow | null {
  const s = minutesOfDay(start);
  const e = minutesOfDay(end);
  if (e <= s) return null;
  return PROTECTED_WINDOWS.find((w) => s < w.end && e > w.start) ?? null;
}

/** 把时间改到当天的指定分钟（用于跳到保护时段结束） */
export function atMinutesOfDay(day: Date, minutes: number): Date {
  const next = new Date(day);
  next.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return next;
}
