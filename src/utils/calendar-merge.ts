/**
 * 「把待办拖进课程里就融合成一滴」的判定规则。
 *
 * 规则：待办的整段时间落在某个事件（课程）之内 → 视为已融合。
 * 选最小的那个容器，避免嵌套日程时并入外层。
 * 完全基于时间推导，不额外存字段：把待办再拖出去，自然就分开了。
 */
export interface RangeLike {
  start: string | Date;
  end: string | Date;
}

/** 允许 1 分钟的边界误差：拖到边缘时多半对不齐整分 */
const TOLERANCE_MS = 60_000;

export function isFullyInside(inner: RangeLike, outer: RangeLike, toleranceMs = TOLERANCE_MS): boolean {
  const iStart = new Date(inner.start).getTime();
  const iEnd = new Date(inner.end).getTime();
  const oStart = new Date(outer.start).getTime();
  const oEnd = new Date(outer.end).getTime();
  if ([iStart, iEnd, oStart, oEnd].some((t) => Number.isNaN(t))) return false;
  if (iEnd <= iStart || oEnd <= oStart) return false;
  return iStart >= oStart - toleranceMs && iEnd <= oEnd + toleranceMs;
}

/** 在候选事件里找出待办应该并入的那个（最贴合、即时间跨度最小的容器） */
export function findMergeTarget<T extends RangeLike>(inner: RangeLike, candidates: T[]): T | null {
  let best: T | null = null;
  let bestSpan = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    if (!isFullyInside(inner, c)) continue;
    const span = new Date(c.end).getTime() - new Date(c.start).getTime();
    if (span < bestSpan) {
      best = c;
      bestSpan = span;
    }
  }
  return best;
}
