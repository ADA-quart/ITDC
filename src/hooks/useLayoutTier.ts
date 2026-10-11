// © 2026 ADA-Quart & TyTs · 日日新（ITDC）· PolyForm Noncommercial 1.0.0 · github.com/ADA-quart/ITDC

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

export type LayoutTier = 'phone' | 'tablet' | 'desktop';

export interface LayoutInfo {
  tier: LayoutTier;
  /** 矮屏（横屏手机）：压缩头部、降低日历最小高度 */
  short: boolean;
  /** 横屏（宽 > 高） */
  landscape: boolean;
}

/**
 * 布局档位（断点不只看宽度——横屏手机是"矮"不是"宽"）：
 * - phone：窄屏（<768）或矮屏（<600，横屏手机）——手机布局 + 横屏压缩
 * - tablet：触屏且 ≥768×600（平板，横竖都算）——沿用手机布局语言（底部胶囊导航、44px 触控）
 * - desktop：非触屏（桌面浏览器 / 鼠标键盘）——保留网页版布局
 */
export function readLayoutInfo(): LayoutInfo {
  if (typeof window === 'undefined') return { tier: 'desktop', short: false, landscape: false };
  const narrow = window.matchMedia('(max-width: 767px)').matches;
  const short = window.matchMedia('(max-height: 599px)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const touch = Capacitor.isNativePlatform() || coarse;
  const tier: LayoutTier = !touch ? 'desktop' : (narrow || short) ? 'phone' : 'tablet';
  return { tier, short, landscape: window.innerWidth > window.innerHeight };
}

export function useLayoutInfo(): LayoutInfo {
  const [info, setInfo] = useState<LayoutInfo>(readLayoutInfo);
  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 767px)');
    const short = window.matchMedia('(max-height: 599px)');
    const coarse = window.matchMedia('(pointer: coarse)');
    const update = () => setInfo(readLayoutInfo());
    narrow.addEventListener('change', update);
    short.addEventListener('change', update);
    coarse.addEventListener('change', update);
    window.addEventListener('orientationchange', update);
    window.addEventListener('resize', update);
    update();
    return () => {
      narrow.removeEventListener('change', update);
      short.removeEventListener('change', update);
      coarse.removeEventListener('change', update);
      window.removeEventListener('orientationchange', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return info;
}

export function useLayoutTier(): LayoutTier {
  return useLayoutInfo().tier;
}
