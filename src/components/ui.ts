import type { CSSProperties } from 'react';

/**
 * 统一的移动端视觉变量。
 *
 * 依据（都指向同一组数字）：
 * - Material Design：最小触控目标 48dp，间距走 4/8dp 栅格，区块间距 24/32dp
 * - Apple HIG：最小触控目标 44×44pt
 * - WCAG 2.5.5（AAA）：目标尺寸 44×44 CSS px
 * - 触控实验研究：约 10mm（≈48dp）的按键在不看屏幕时命中率最好
 */
export const TOUCH_TARGET = 48;
export const CARD_RADIUS = 12;

/**
 * 字体栈：优先用设备自带的中文 UI 字体。
 * 依据 Apple HIG「用系统字体保证各字号都清晰」与中文可读性研究（简体中文在手机上的
 * 字号/行距会显著影响阅读时间与视觉疲劳），手机上直接用系统字体比塞网络字体更好。
 */
export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "HarmonyOS Sans SC", "MiSans", "PingFang SC", ' +
  '"Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", system-ui, sans-serif';

/**
 * 字号体系，对齐 Material 3 的 type scale（正文 14/22，大字 16/24，标签 11-12）。
 * 中文比拉丁字母需要更大的字号与行距，所以行高都往 1.5-1.6 靠。
 */
export const TYPE = {
  /** 11/16 标签（最小可读字号，Apple HIG 下限 11pt） */
  label: { fontSize: 11, lineHeight: 1.45 },
  /** 12/18 次要信息 */
  caption: { fontSize: 12, lineHeight: 1.5 },
  /** 14/22 正文 */
  body: { fontSize: 14, lineHeight: 1.57 },
  /** 16/24 强调正文 */
  bodyLarge: { fontSize: 16, lineHeight: 1.5 },
  /** 15/22 区块标题 */
  section: { fontSize: 15, lineHeight: 1.45, fontWeight: 600 },
} as const;

/** 数字等宽：时间、日期、计数在一列里对得齐 */
export const tabularNums: CSSProperties = { fontVariantNumeric: 'tabular-nums' };

/** #RRGGBB → rgba(...)：用于选中态的浅色底，避免手写一堆十六进制 */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** 卡片容器：圆角 12、移动端 16dp 内边距，浅色下用极轻阴影代替硬边框 */
export function cardStyle(
  isDark: boolean,
  isMobile: boolean,
  opts: { padding?: number } = {},
): CSSProperties {
  return {
    background: isDark ? '#1f1f1f' : '#fff',
    borderRadius: CARD_RADIUS,
    padding: opts.padding ?? (isMobile ? 16 : 24),
    boxShadow: isDark ? 'none' : '0 1px 2px rgba(0,0,0,0.03), 0 2px 8px rgba(0,0,0,0.05)',
  };
}

/** 区块标题：统一 15px/600，替代浏览器默认 h4（16px 粗体 + 大边距，手机上显得又重又空） */
export const sectionTitleStyle: CSSProperties = {
  ...TYPE.section,
  margin: '0 0 8px',
};

/** 次要说明文字：#666 在浅色下对比度 5.7:1，#999 只有 2.8:1 达不到 WCAG AA 的 4.5:1 */
export function hintTextStyle(isDark: boolean): CSSProperties {
  return {
    ...TYPE.caption,
    margin: 0,
    color: isDark ? '#999' : '#666',
  };
}

/** 统一的次要文字颜色（浅色模式一律 #666，避免各处写 #999 掉到 2.8:1） */
export function secondaryTextColor(isDark: boolean): string {
  return isDark ? '#a6a6a6' : '#666';
}
