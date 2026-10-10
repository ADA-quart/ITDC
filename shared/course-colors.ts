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
  '#d4380d',
  '#531dab',
  '#006d75',
  '#9e1068',
  // 一个学期十几门课很常见，色板备到 22 个：同为深色系（压得住白字），
  // 但色相交错排列，分配时相邻的课不容易拿到相近的颜色
  '#1d39c4',
  '#5b8c00',
  '#003a8c',
  '#873800',
  '#a8071a',
  '#237804',
  '#c41d7f',
  '#00474f',
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
export function assignCourseColors(names: string[]): Map<string, string> {
  const unique = [...new Set(names.map((n) => String(n ?? '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh'));
  const size = COURSE_PALETTE.length;
  const out = new Map<string, string>();
  const taken = new Set<number>();
  for (const name of unique) {
    let idx = hashOf(name) % size;
    for (let step = 0; step < size && taken.has(idx); step += 1) {
      idx = (idx + 1) % size;
    }
    taken.add(idx);
    out.set(name, COURSE_PALETTE[idx]);
  }
  return out;
}
