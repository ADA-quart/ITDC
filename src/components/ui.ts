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
  fontSize: 15,
  fontWeight: 600,
  lineHeight: 1.4,
  margin: '0 0 8px',
};

/** 次要说明文字 */
export function hintTextStyle(isDark: boolean): CSSProperties {
  return {
    fontSize: 12,
    lineHeight: 1.5,
    margin: 0,
    color: isDark ? '#999' : '#666',
  };
}
