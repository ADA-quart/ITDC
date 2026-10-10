/**
 * 每门课的自定义颜色：课程名 → #RRGGBB。
 *
 * 只存"用户改过"的课；没改过的走 assignCourseColors 的自动配色。
 * 按课程名存（而不是按事件 id），所以同一门课的所有时间段、跨周都跟着变，
 * 重新导入课表也还认得出。改完广播 itdc-course-colors-changed，
 * 日历视图与课表网格据此重渲染。
 */
const KEY = 'itdc_course_colors';
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export const COURSE_COLORS_CHANGED = 'itdc-course-colors-changed';

export function getCourseColorOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed ?? {})) {
      if (typeof value === 'string' && HEX_RE.test(value)) out[name] = value.toUpperCase();
    }
    return out;
  } catch {
    return {};
  }
}

/** color 传 null = 恢复自动配色 */
export function setCourseColorOverride(courseName: string, color: string | null): void {
  if (!courseName) return;
  const map = getCourseColorOverrides();
  if (color && HEX_RE.test(color)) map[courseName] = color.toUpperCase();
  else delete map[courseName];
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch { /* 配额满时本次会话内仍可预览 */ }
  try {
    window.dispatchEvent(new CustomEvent(COURSE_COLORS_CHANGED));
  } catch { /* 非浏览器环境忽略 */ }
}
