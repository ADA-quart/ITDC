/**
 * 排程时间策略：客户端算法、服务端算法、LLM 校验与提示词共用同一套口径，
 * 避免"算法避开午饭、LLM 却排到午饭"这类不一致。
 */

/** 不排早于 8:00 的任务：7 点排待办属于打扰而不是帮助 */
export const WORK_START_HOUR = 8;
/** 22:00 前必须结束：不排到 23:00/24:00 */
export const WORK_END_HOUR = 22;
/** 21:00 之后不再开始新任务：晚课结束就直接休息 */
export const LATE_START_HOUR = 21;
/** 两节课之间的空档小于这个值就不排任务（5/25 分钟课间不硬塞） */
export const MIN_USABLE_GAP_MINUTES = 30;
/** 任务结束到下一个日程之间至少留 5 分钟缓冲 */
export const SLOT_BUFFER_MINUTES = 5;

/**
 * 夜间加时窗口：22:00-22:30 **只留给「紧急重要」**。
 *
 * 背景：22:00 之后是休息时间，只有真的紧急的事才值得排进去（用户会在图书馆待到 22:30）。
 * 其余任务维持原样——21:00 之后不新开、22:00 前必须结束。
 * 客户端算法、服务端算法、LLM 提示词、LLM 结果校验共用这一条，口径不允许各写一份。
 */
export const LATE_NIGHT_START_MINUTES = 22 * 60;
export const LATE_NIGHT_END_MINUTES = 22 * 60 + 30;

/** 哪些优先级能用夜间加时窗口（目前只有「紧急重要」） */
export function canUseLateNightWindow(priority: string | null | undefined): boolean {
  return priority === 'urgent-important';
}

/** 当天可排到几点（分钟）：普通任务 22:00，紧急重要 22:30 */
export function dayEndMinutes(allowLateNight: boolean): number {
  return allowLateNight ? LATE_NIGHT_END_MINUTES : WORK_END_HOUR * 60;
}

/** 当天最晚几点开始（分钟）：普通任务 21:00，紧急重要 22:30（时长与缓冲另行约束） */
export function latestStartMinutes(allowLateNight: boolean): number {
  return allowLateNight ? LATE_NIGHT_END_MINUTES : LATE_START_HOUR * 60;
}

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
