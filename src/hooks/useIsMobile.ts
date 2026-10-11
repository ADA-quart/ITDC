// © 2026 ADA-Quart & TyTs · 日日新（ITDC）· PolyForm Noncommercial 1.0.0 · github.com/ADA-quart/ITDC

import { useLayoutInfo } from './useLayoutTier';

/**
 * 是否走触屏布局（手机 / 平板）。
 *
 * 判定收在 useLayoutInfo 里，不再只看宽度：横屏手机（矮屏）也走触屏布局，
 * 平板（≥768×600 的触屏）同样沿用手机布局语言；桌面浏览器保留网页版。
 * 订阅 matchMedia，旋转与分屏变化不会漏。
 */
export function useIsMobile(): boolean {
  return useLayoutInfo().tier !== 'desktop';
}

export default useIsMobile;
