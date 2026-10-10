import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  DEFAULT_APPEARANCE,
  loadAppearance,
  loadBackgroundImage,
  pushWidgetAppearance,
  resetPushedImageCache,
  saveAppearance,
  saveBackgroundImage,
  type AppearanceSettings,
} from '../api/appearance';
import { GLASS_FILTER_ID } from '../components/GlassFilters';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextType {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  isDark: boolean;
  /** 用户自定义外观（主题色 / 背景图 / 小组件配色） */
  appearance: AppearanceSettings;
  updateAppearance: (patch: Partial<AppearanceSettings>) => void;
  /** 只把小组件相关字段恢复默认（保留主题色与背景图） */
  resetWidgetAppearance: () => void;
  resetAppearance: () => Promise<void>;
  /** 背景图是否已从 IndexedDB 恢复（首次加载时为 false） */
  appearanceLoaded: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  mode: 'light',
  setMode: () => {},
  isDark: false,
  appearance: DEFAULT_APPEARANCE,
  updateAppearance: () => {},
  resetWidgetAppearance: () => {},
  resetAppearance: async () => {},
  appearanceLoaded: false,
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('theme');
    return (saved === 'light' || saved === 'dark' || saved === 'system') ? saved : 'light';
  });

  const [systemDark, setSystemDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  const [appearance, setAppearance] = useState<AppearanceSettings>(() => loadAppearance());
  const [appearanceLoaded, setAppearanceLoaded] = useState(false);
  /** 背景图平均亮度（暗=true）；用于「图片主导视觉时自动切换明暗方案」 */
  const [bgImageDark, setBgImageDark] = useState<boolean | null>(null);

  // 背景图存在 IndexedDB，启动时异步补上；补齐前先用纯色，避免白屏等待
  useEffect(() => {
    let alive = true;
    void loadBackgroundImage().then((image) => {
      if (!alive) return;
      setAppearance((prev) => (image === prev.bgImage ? prev : { ...prev, bgImage: image }));
      setAppearanceLoaded(true);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    // 原生侧推来的系统深浅色（WebView 的媒体查询在切主题时不刷新，只能靠原生通知）
    const nativeHandler = (e: Event) => {
      const dark = (e as CustomEvent<{ dark?: boolean }>).detail?.dark;
      if (typeof dark === 'boolean') setSystemDark(dark);
    };
    window.addEventListener('itdc-system-theme', nativeHandler);
    return () => {
      mq.removeEventListener('change', handler);
      window.removeEventListener('itdc-system-theme', nativeHandler);
    };
  }, []);

  // 背景图主导视觉（uiOpacity 很低、卡片几乎全透）时按图自适应：
  // 深色照片上白卡变全透后黑字会看不清——此时直接跟随图片明暗切换方案
  // （深图 → 深玻璃 + 白字；亮图 → 浅玻璃 + 黑字）。透明度较高（卡片仍以浅色为主）时不干预。
  let isDark = mode === 'dark' || (mode === 'system' && systemDark);
  if (appearance.bgImage && bgImageDark !== null && appearance.uiOpacity < 50) {
    isDark = bgImageDark;
  }

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    localStorage.setItem('theme', m);
  }, []);

  const updateAppearance = useCallback((patch: Partial<AppearanceSettings>) => {
    setAppearance((prev) => {
      const next = { ...prev, ...patch };
      saveAppearance(next);
      // 图片换了或删了才写 IndexedDB，滑动条之类的调整不碰存储
      if ('bgImage' in patch && patch.bgImage !== prev.bgImage) {
        if (next.bgImage === null) resetPushedImageCache();
        void saveBackgroundImage(next.bgImage);
      }
      return next;
    });
  }, []);

  const resetAppearance = useCallback(async () => {
    resetPushedImageCache();
    setAppearance({ ...DEFAULT_APPEARANCE });
    try {
      localStorage.removeItem('itdc_appearance');
      await saveBackgroundImage(null);
    } catch {
      // 清理失败不影响本次会话已经回到默认外观
    }
  }, []);

  const resetWidgetAppearance = useCallback(() => {
    updateAppearance({
      widgetFollowAccent: DEFAULT_APPEARANCE.widgetFollowAccent,
      widgetAccent: DEFAULT_APPEARANCE.widgetAccent,
      widgetPanelColor: DEFAULT_APPEARANCE.widgetPanelColor,
      widgetPanelOpacity: DEFAULT_APPEARANCE.widgetPanelOpacity,
      widgetScheme: DEFAULT_APPEARANCE.widgetScheme,
      widgetUseBgImage: DEFAULT_APPEARANCE.widgetUseBgImage,
    });
  }, [updateAppearance]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    document.body.style.colorScheme = isDark ? 'dark' : 'light';
  }, [isDark]);

  // 主题色写成 CSS 变量，供不走 antd token 的零散样式（如移动端底栏）复用
  useEffect(() => {
    document.documentElement.style.setProperty('--itdc-accent', appearance.accent);
  }, [appearance.accent]);

  // 采样背景图平均亮度（32×32 缩略图 + 相对亮度公式）
  useEffect(() => {
    const img = appearance.bgImage;
    if (!img) {
      setBgImageDark(null);
      return;
    }
    let alive = true;
    const el = new Image();
    el.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(el, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data;
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        }
        // 阈值 100：只有明显偏暗的图才切深色方案；
        // 中亮图（100-160 之间）用黑字更稳——黑白字在"半亮"底上都勉强，
        // 但亮区更多时黑字的对比度普遍更好。
        if (alive) setBgImageDark(sum / (data.length / 4) < 100);
      } catch {
        if (alive) setBgImageDark(null);
      }
    };
    el.onerror = () => {
      if (alive) setBgImageDark(null);
    };
    el.src = img;
    return () => {
      alive = false;
    };
  }, [appearance.bgImage]);

  // 有自定义背景图时把卡片/课表格子玻璃化：图片透出来，文字仍有底可读
  useEffect(() => {
    const root = document.documentElement;
    const hasBg = !!appearance.bgImage;
    const liquid = appearance.liquidGlass;
    // 液态玻璃可以在没有背景图时也打开：卡片变半透 + 更强模糊/饱和度 + 内高光
    const glass = hasBg || liquid;
    const ui = appearance.uiOpacity / 100;
    const cellAlpha = Math.max(0, ui * 0.7);
    const headAlpha = Math.min(1, ui * 0.85);
    // 普通通栏底栏保持高不透明（否则列表文字从下面透上来重影）；
    // 液态玻璃的底栏是悬浮胶囊，透明度跟着面板走（默认 62%），模糊 + 折射才透得出来
    const navAlpha = liquid
      ? Math.min(0.8, Math.max(0.45, ui))
      : Math.min(1, Math.max(0.92, ui + 0.12));
    const blurPx = Math.max(appearance.uiBlur, liquid ? 20 : 0);
    // 液态玻璃的"折射"：把 SVG 位移滤镜接进 backdrop-filter（Chromium 支持；
    // 不支持 url() 滤镜时退回纯磨砂，不会整块失效）。CSS.supports 探测一次即可。
    const canRefract = liquid
      && typeof CSS !== 'undefined'
      && typeof CSS.supports === 'function'
      && CSS.supports('backdrop-filter', `url(#${GLASS_FILTER_ID})`);
    const refract = canRefract ? ` url(#${GLASS_FILTER_ID})` : '';
    const blur = glass && blurPx > 0
      ? `blur(${blurPx}px)${liquid ? ' saturate(180%) brightness(1.04)' : ''}${refract}`
      : 'none';
    const navBlur = glass
      ? `blur(${Math.max(appearance.uiBlur, liquid ? 20 : 8)}px)${liquid ? ' saturate(180%) brightness(1.04)' : ''}${refract}`
      : 'none';
    document.body.classList.toggle('itdc-has-bg-image', glass);
    document.body.classList.toggle('itdc-liquid-glass', liquid);
    // 液态玻璃的内高光边：写在 shadow 变量里，卡片/小组件预览都不用各自加 border
    root.style.setProperty(
      '--itdc-card-shadow',
      liquid
        ? `inset 0 1px 0 rgba(255,255,255,${isDark ? 0.16 : 0.55}), 0 12px 32px rgba(15,23,42,0.18)`
        : (isDark ? 'none' : '0 1px 2px rgba(0,0,0,0.03), 0 2px 8px rgba(0,0,0,0.05)'),
    );
    // 镜面高光层：位置由 --itdc-spec-x/y 决定，倾斜手机或移动指针时光会扫过表面
    root.style.setProperty(
      '--itdc-card-sheen',
      liquid
        ? `radial-gradient(140% 110% at var(--itdc-spec-x, 26%) var(--itdc-spec-y, 0%), `
          + `rgba(255,255,255,${isDark ? 0.22 : 0.55}) 0%, `
          + `rgba(255,255,255,${isDark ? 0.06 : 0.16}) 34%, `
          + 'rgba(255,255,255,0) 68%)'
        : 'none',
    );
    root.style.setProperty(
      '--itdc-nav-sheen',
      liquid
        ? `radial-gradient(160% 120% at var(--itdc-spec-x, 50%) var(--itdc-spec-y, 0%), `
          + `rgba(255,255,255,${isDark ? 0.18 : 0.5}) 0%, `
          + 'rgba(255,255,255,0) 60%)'
        : 'none',
    );
    root.style.setProperty(
      '--itdc-card-bg',
      glass
        ? (isDark ? `rgba(18, 18, 20, ${ui})` : `rgba(255, 255, 255, ${ui})`)
        : (isDark ? '#1f1f1f' : '#fff')
    );
    root.style.setProperty('--itdc-card-blur', blur);
    root.style.setProperty(
      '--itdc-cell-bg',
      glass
        ? (isDark ? `rgba(18, 18, 20, ${cellAlpha})` : `rgba(255, 255, 255, ${cellAlpha})`)
        : (isDark ? '#1b1b1b' : '#fff')
    );
    root.style.setProperty(
      '--itdc-head-bg',
      glass
        ? (isDark ? `rgba(30, 30, 32, ${headAlpha})` : `rgba(255, 255, 255, ${headAlpha})`)
        : (isDark ? '#232323' : '#fafafa')
    );
    root.style.setProperty(
      '--itdc-border',
      glass
        ? (isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.10)')
        : (isDark ? '#303030' : '#ececec')
    );
    root.style.setProperty(
      '--itdc-nav-bg',
      glass
        ? (isDark ? `rgba(18, 18, 20, ${navAlpha})` : `rgba(255, 255, 255, ${navAlpha})`)
        : (isDark ? '#1f1f1f' : '#fff')
    );
    root.style.setProperty('--itdc-nav-blur', navBlur);
    // 输入框类控件的实底色（与 antd colorBgContainer 同值）：背景图模式下
    // "分钟"这类 addon 默认是半透明填充，会透出壁纸，用它改成不透明白/黑
    root.style.setProperty('--itdc-field-bg', isDark ? '#141414' : '#ffffff');
    // 图片主导（低透明度）时次级文字加深/加亮：灰字压半透背景最容易糊
    const imageDominant = hasBg && appearance.uiOpacity < 50;
    root.style.setProperty(
      '--itdc-fg-secondary',
      imageDominant ? (isDark ? '#d9d9d9' : '#333333') : (isDark ? '#a6a6a6' : '#666666')
    );
  }, [appearance.bgImage, appearance.uiOpacity, appearance.uiBlur, appearance.liquidGlass, isDark]);

  // 镜面高光跟随设备运动：苹果的 Liquid Glass 高光会响应设备姿态与触摸。
  // 手机上用 deviceorientation（gamma/beta）映射高光位置；桌面/模拟器没有陀螺仪时退回指针位置。
  useEffect(() => {
    if (!appearance.liquidGlass) return;
    const root = document.documentElement;
    let x = 26;
    let y = 0;
    let raf = 0;
    const apply = () => {
      raf = 0;
      root.style.setProperty('--itdc-spec-x', `${x.toFixed(1)}%`);
      root.style.setProperty('--itdc-spec-y', `${y.toFixed(1)}%`);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      // gamma：左右倾斜 -90..90 → 0..100%；beta：前后 -180..180（握持时约 40-60）
      x = Math.max(0, Math.min(100, 50 + e.gamma * 0.9));
      y = Math.max(0, Math.min(100, 50 + (e.beta - 45) * 1.2));
      schedule();
    };
    const onPointer = (e: PointerEvent) => {
      x = Math.max(0, Math.min(100, (e.clientX / Math.max(1, window.innerWidth)) * 100));
      y = Math.max(0, Math.min(100, (e.clientY / Math.max(1, window.innerHeight)) * 100));
      schedule();
    };
    window.addEventListener('deviceorientation', onOrient);
    window.addEventListener('pointermove', onPointer);
    return () => {
      window.removeEventListener('deviceorientation', onOrient);
      window.removeEventListener('pointermove', onPointer);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [appearance.liquidGlass]);

  // 外观变化推给桌面小组件。150ms 防抖：拖动不透明度滑块时不必每帧重建一次桌面视图。
  useEffect(() => {
    const timer = setTimeout(() => {
      void pushWidgetAppearance(appearance).catch(() => {});
    }, 150);
    return () => clearTimeout(timer);
  }, [appearance]);

  return (
    <ThemeContext.Provider
      value={{ mode, setMode, isDark, appearance, updateAppearance, resetWidgetAppearance, resetAppearance, appearanceLoaded }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme() {
  return useContext(ThemeContext);
}
