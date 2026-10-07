/**
 * 课程配色：按课程名稳定取色。
 *
 * 同一门课每次导入都得到同一个颜色；不同课程尽量落在不同颜色上。
 * 调色板取的是彼此区分度高、深浅接近的一组（都能压住白字）。
 */
export const COURSE_PALETTE = [
  '#1677ff',
  '#722ed1',
  '#13c2c2',
  '#fa8c16',
  '#52c41a',
  '#eb2f96',
  '#2f54eb',
  '#faad14',
  '#08979c',
  '#f5222d',
];

/** 课程名 → 固定颜色（简单哈希，够稳定） */
export function colorForCourse(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return COURSE_PALETTE[hash % COURSE_PALETTE.length];
}
