/**
 * 课程配色：按课程名稳定取色。
 *
 * 同一门课每次导入都得到同一个颜色；不同课程尽量落在不同颜色上。
 *
 * 选色的三条依据（查过文献与规范，不是拍脑袋）：
 *   1. 白字可读性（WCAG 2.2 SC 1.4.3）：正文对比度要 ≥4.5:1；白字要达标，
 *      底色相对亮度必须 ≤0.183。下面是高饱和中深档（Tailwind 700/800 一档），
 *      白字对比度实测全部 ≥5:1：旧的浅亮档里 #ffc53d 只有 1.6:1、#52c41a 只有
 *      2.3:1，白字糊成一片，越看越"没精神"，问题就出在明度上。
 *   2. 愉悦色相（Valdez & Mehrabian, 1994）：蓝、蓝绿、绿、紫、紫红是实验里
 *      最让人愉悦的色相，黄、绿黄最不愉悦；Palmer & Schloss（PNAS, 2010）的
 *      生态效价理论同样显示偏好集中在蓝色系、谷底在暗黄/棕。所以色板以
 *      蓝→青→绿→紫→玫红为主，红/橙只留少量用来拉开区分度，黄与绿黄整体不用。
 *   3. 饱和度（Wilms & Oberfeld, 2018）：饱和度对愉悦/唤醒的影响比色相还大。
 *      明度被白字锁死后，就把色相和饱和度拉满——高饱和也顺带解决了"脏色"。
 */
export const COURSE_PALETTE = [
  // 第一轮 14 色：冷暖交替排，冲突顺延时也能落到差别大的色相上
  '#1d4ed8', // 蓝
  '#b91c1c', // 红
  '#047857', // 翡翠绿
  '#6d28d9', // 紫罗兰
  '#0369a1', // 天蓝
  '#c2410c', // 橙
  '#0f766e', // 青绿
  '#a21caf', // 品红
  '#15803d', // 绿
  '#be185d', // 粉
  '#4338ca', // 靛蓝
  '#0e7490', // 青
  '#7e22ce', // 紫
  '#be123c', // 玫红
  // 第二轮 10 色：同色相深一档，课程超过 14 门时接着用
  '#1e40af',
  '#991b1b',
  '#065f46',
  '#5b21b6',
  '#075985',
  '#9a3412',
  '#115e59',
  '#86198f',
  '#166534',
  '#9d174d',
];

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

/** 白字压在这个底色上的对比度（白字相对亮度 = 1） */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}

/**
 * 底色上该用白字还是黑字。
 *
 * 任意底色与白/黑之一的对比度必然 ≥4.5:1（WCAG 正文底线），取更高的一档即可：
 * 自动配色清一色白字（全部 ≥5:1），用户自选的浅色（取色器里可能调到浅黄）自动切黑字。
 */
export function readableTextColor(hex: string): '#fff' | '#000' {
  const luminance = relativeLuminance(hex);
  const white = 1.05 / (luminance + 0.05);
  const black = (luminance + 0.05) / 0.05;
  return white >= black ? '#fff' : '#000';
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
