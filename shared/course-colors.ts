/**
 * 课程配色：按课程名稳定取色。
 *
 * 同一门课每次导入都得到同一个颜色；不同课程尽量落在不同颜色上。
 * 21 色鲜艳中深档（antd 6/7 级为主）：课块上是白字，所以底色不能太浅；
 * 同时**不用棕、橄榄、灰青这类发脏的颜色**，偏亮一档但不刺眼。
 */
export const COURSE_PALETTE = [
  '#1677ff',
  '#722ed1',
  '#08979c',
  '#fa8c16',
  '#389e0d',
  '#eb2f96',
  '#2f54eb',
  '#d48806',
  '#f5222d',
  '#9254de',
  '#13c2c2',
  '#d46b08',
  '#52c41a',
  '#c41d7f',
  '#1d39c4',
  '#cf1322',
  '#531dab',
  '#fa541c',
  '#0958d9',
  '#d4380d',
  '#237804',
];

function hashOf(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash;
}

/** 课程名 → 固定颜色（简单哈希，够稳定） */
export function colorForCourse(name: string): string {
  return COURSE_PALETTE[hashOf(name) % COURSE_PALETTE.length];
}

/**
 * 一套课表（一学期）里的课程名 → 颜色，**互不撞色**。
 *
 * 单看哈希必然会撞（10 色给十几门课），而同一格里两门课同色就分不清了。
 * 这里按「课程名排序 + 哈希定位 + 冲突顺延」分配：同一套课表每次结果完全一样
 * （同门课永远同色、跨周也稳定），不同课程在调色板够用时不重复。
 */
export function assignCourseColors(
  names: string[],
  overrides?: Record<string, string>,
): Map<string, string> {
  const unique = [...new Set(names.map((n) => String(n ?? '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh'));
  const size = COURSE_PALETTE.length;
  const out = new Map<string, string>();
  const taken = new Set<number>();
  for (const name of unique) {
    // 用户自定义的颜色优先，且不占自动色位（不会把别人的颜色挤走）
    const custom = overrides?.[name];
    if (custom) {
      out.set(name, custom);
      continue;
    }
    let idx = hashOf(name) % size;
    for (let step = 0; step < size && taken.has(idx); step += 1) {
      idx = (idx + 1) % size;
    }
    taken.add(idx);
    out.set(name, COURSE_PALETTE[idx]);
  }
  return out;
}
