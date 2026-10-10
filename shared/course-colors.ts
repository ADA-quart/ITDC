/**
 * 课程配色：按课程名稳定取色。
 *
 * 同一门课每次导入都得到同一个颜色；不同课程尽量落在不同颜色上。
 * 30 色清爽鲜艳档（antd 4/5/6 级色），**不含棕色、橄榄、深青这类发脏的颜色**；
 * 亮底上的文字颜色由 textColorFor 按亮度自动切深色。
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
  '#f5222d',
  '#9254de',
  '#36cfc9',
  '#ffa940',
  '#73d13d',
  '#f759ab',
  '#597ef7',
  '#ffc53d',
  '#ff7875',
  '#ff9c6e',
  '#b37feb',
  '#95de64',
  '#ffd666',
  '#69c0ff',
  '#5cdbd3',
  '#ffadd2',
  '#85a5ff',
  '#a0d911',
  '#d3adf7',
  '#40a9ff',
  '#ff85c0',
  '#bae637',
];

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * 课程色块上该用深色字还是白字：按 WCAG 相对亮度挑对比度更高的那个。
 * 亮色系课表（#69c0ff、#ffd666 这种）配白字会糊成一片，必须换深色字。
 */
export function textColorFor(background: string): string {
  const rgb = parseHex(background);
  if (!rgb) return '#ffffff';
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
  // 0.179 是白字/黑字对比度相等的分界（WCAG 常用阈值）
  return lum > 0.179 ? 'rgba(0,0,0,0.88)' : '#ffffff';
}

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
