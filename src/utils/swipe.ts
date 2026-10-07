/**
 * 日历滑动翻页判定。
 *
 * 只在「横向位移够大、且明显大于纵向」时翻页：
 * 课表本身要上下滚动，纵向手势不能和翻页打架。
 */
export function swipeDirection(dx: number, dy: number, threshold = 60): 'next' | 'prev' | null {
  if (Math.abs(dx) < threshold) return null;
  if (Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? 'next' : 'prev';
}
