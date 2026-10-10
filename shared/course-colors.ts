/**
 * 课程配色：按课程名稳定取色。
 *
 * 同一门课每次导入都得到同一个颜色；不同课程尽量落在不同颜色上。
 *
 * 走「明亮底色 + 石墨灰字」这一档（antd 2/3 级浅色，红→橙→黄→绿→青→蓝→紫齐全）：
 *   - 底色亮、字色灰：白字压彩底要够深才达标（相对亮度 ≤0.183），观感会重；
 *     亮底配灰字则相反——浅色只管活泼，字有灰度不刺眼，比白字/纯黑都耐看；
 *   - 12 个色相 × 深浅两档共 24 色，每个色配 #3f3f46 石墨灰的对比度实测
 *     5.4–10.1:1，全部满足 WCAG 2.2 正文 ≥4.5:1（白字压这些浅底只有 1.5:1 左右）；
 *   - 全是浅色档，避开会让浅色发脏的深金/橄榄/棕；色相排序见 COURSE_PALETTE_BY_HUE。
 */
export const COURSE_PALETTE = [
  // 冷暖交替排：冲突顺延时也能落到差别大的色相上
  '#ffccc7', // 红 2
  '#bae0ff', // 蓝 2
  '#ffe58f', // 金 3
  '#d3adf7', // 紫 3
  '#b7eb8f', // 绿 3
  '#ffd6e7', // 品红 2
  '#91caff', // 蓝 3
  '#ffd591', // 橙 3
  '#87e8de', // 青 3
  '#d6e4ff', // 极客蓝 2
  '#ffbb96', // 火山 3
  '#eaff8f', // 青柠 3
  '#ffadd2', // 品红 3
  '#adc6ff', // 极客蓝 3
  '#fffb8f', // 黄 3
  '#b5f5ec', // 青 2
  '#ffa39e', // 红 3
  '#d9f7be', // 绿 2
  '#ffe7ba', // 橙 2
  '#efdbff', // 紫 2
  '#f4ffb8', // 青柠 2
  '#ffd8bf', // 火山 2
  '#ffffb8', // 黄 2
  '#fff1b8', // 金 2
];

/** 明亮课程色上的默认字色：石墨灰（不用纯黑，和浅彩底更搭） */
export const COURSE_INK = '#3f3f46';

/** sRGB 相对亮度（WCAG 2.2 的定义），用来算对比度 */
export function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex ?? '').trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel((n >> 16) & 255)
    + 0.7152 * channel((n >> 8) & 255)
    + 0.0722 * channel(n & 255);
}

/** 任意两色的 WCAG 对比度 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** 白字压在这个底色上的对比度（白字相对亮度 = 1） */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}

/**
 * 底色上该用什么字色：
 *   - 明亮底 → 石墨灰（首选；浅彩底 + 灰字比白字/纯黑都耐看）；
 *   - 灰字不够 → 白字（用户自选到深色时）；
 *   - 都不够 → 纯黑兜底（中间明度的自选色，白/黑必有一侧 ≥4.5:1）。
 */
export function readableTextColor(hex: string): string {
  if (contrastRatio(hex, COURSE_INK) >= 4.5) return COURSE_INK;
  if (contrastWithWhite(hex) >= 4.5) return '#fff';
  return '#000';
}

function hashOf(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash;
}

/** 十六进制 → 色相（0-360），用于按"红橙黄绿青蓝紫"排序展示 */
function hueOf(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/**
 * 给选色界面用的"按色相排序"副本：红 → 橙 → 黄 → 绿 → 青 → 蓝 → 紫（玫红/洋红收尾）。
 *
 * 注意别拿它做自动分配——分配靠哈希 + 冲突顺延，调色板交错排列才能让相邻的课
 * 拿到差别大的颜色；按色相排会让冲突时顺延到几乎同色的邻项。
 */
export const COURSE_PALETTE_BY_HUE: string[] = [...COURSE_PALETTE]
  .sort((a, b) => sortKeyByHue(a) - sortKeyByHue(b));

/**
 * 色相环上红≈0/360°、玫红≈330°：把 345° 以上（纯红那一档）折到负数，
 * 红色就排到最前；玫红仍留在结尾，符合"红橙黄绿青蓝紫 + 玫红收尾"的读法。
 */
function sortKeyByHue(hex: string): number {
  const h = hueOf(hex);
  return h >= 345 ? h - 360 : h;
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
