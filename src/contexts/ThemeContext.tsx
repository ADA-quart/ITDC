// © 2026 ADA-Quart & TyTs · 日日新（ITDC）· PolyForm Noncommercial 1.0.0 · github.com/ADA-quart/ITDC

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  DEFAULT_APPEARANCE,
  loadAppearance,
  loadBackgroundImage,
  loadWidgetBackgroundImage,
  pushWidgetAppearance,
  resetPushedImageCache,
  saveAppearance,
  saveBackgroundImage,
  saveWidgetBackgroundImage,
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

  // 背景图（应用 + 小组件专属）存在 IndexedDB，启动时异步补上；
  // 补齐前先用纯色，避免白屏等待
  useEffect(() => {
    let alive = true;
    void Promise.all([loadBackgroundImage(), loadWidgetBackgroundImage()]).then(([image, widgetImage]) => {
      if (!alive) return;
      setAppearance((prev) => (
        image === prev.bgImage && widgetImage === prev.widgetBgImage
          ? prev
          : { ...prev, bgImage: image, widgetBgImage: widgetImage }
      ));
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

  // 明暗完全交给用户（浅色 / 深色 / 跟随系统）：不再按背景图亮度自动翻转——
  // 之前背景图主导视觉（uiOpacity < 50）时会隐式跟随图片明暗，用户选了浅色也会被翻成深色。
  const isDark = mode === 'dark' || (mode === 'system' && systemDark);

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
      // 小组件专属图换了或删了：让推送缓存失效，下一轮才会把新图（或"清图"指令）带给原生
      if ('widgetBgImage' in patch && patch.widgetBgImage !== prev.widgetBgImage) {
        resetPushedImageCache();
        void saveWidgetBackgroundImage(next.widgetBgImage);
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
      await saveWidgetBackgroundImage(null);
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
      widgetBgImage: DEFAULT_APPEARANCE.widgetBgImage,
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
    // 液态玻璃的底栏是悬浮胶囊，内容会从胶囊底下滚过去——不透明度与模糊都必须强于面板
    // （默认面板 62% / 14px → 胶囊 80% / 22px），否则透过去能看到滚动的文字，很诡异。
    // 跟随面板滑条但不低于"面板 +18% / +8px"，封顶 92% / 40px。
    const navAlpha = liquid
      ? Math.min(0.92, Math.max(0.72, ui + 0.18))
      : Math.min(1, Math.max(0.92, ui + 0.12));
    // 液态玻璃只保证一个"磨砂下限"（8px），其余交给滑条——不然滑到 20 以下完全没反应，
    // 用户会以为"日历透明度/模糊调不了"；折射与高光才是液态的主体，不靠死磕模糊值。
    const blurPx = Math.max(appearance.uiBlur, liquid ? 8 : 0);
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
    // 胶囊模糊 = 面板模糊 + 8px（液态玻璃下）；非液态玻璃保持面板值
    const navBlurPx = liquid
      ? Math.min(40, Math.max(appearance.uiBlur, 8) + 8)
      : Math.max(appearance.uiBlur, 8);
    const navBlur = glass
      ? `blur(${navBlurPx}px)${liquid ? ' saturate(180%) brightness(1.04)' : ''}${refract}`
      : 'none';
    // 交互降级：折射滤镜每帧都要重算 turbulence，拖动 / 滚动时很贵（会掉帧甚至闪一下）。
    // 只去掉最贵的 url(#折射)，模糊 / 饱和度 / 亮度 / 高光层全部保持不变——
    // 之前连 saturate+高光一起撤，点一下颜色就"跳"一次，看起来像饱和度突然变高。
    const liteCardBlur = glass && blurPx > 0
      ? `blur(${blurPx}px)${liquid ? ' saturate(180%) brightness(1.04)' : ''}`
      : 'none';
    const liteNavBlur = glass
      ? `blur(${navBlurPx}px)${liquid ? ' saturate(180%) brightness(1.04)' : ''}`
      : 'none';
    const cardSheen = liquid
      ? `radial-gradient(140% 110% at var(--itdc-spec-x, 26%) var(--itdc-spec-y, 0%), `
        + `rgba(255,255,255,${isDark ? 0.22 : 0.55}) 0%, `
        + `rgba(255,255,255,${isDark ? 0.06 : 0.16}) 34%, `
        + 'rgba(255,255,255,0) 68%)'
      : 'none';
    const navSheen = liquid
      ? `radial-gradient(160% 120% at var(--itdc-spec-x, 50%) var(--itdc-spec-y, 0%), `
        + `rgba(255,255,255,${isDark ? 0.18 : 0.5}) 0%, `
        + 'rgba(255,255,255,0) 60%)'
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
    root.style.setProperty('--itdc-card-sheen', cardSheen);
    root.style.setProperty('--itdc-nav-sheen', navSheen);
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
    // 拖动 / 滚动期间降档：只去掉最贵的折射滤镜，其余参数与完整版逐字节一致。
    // 可见参数（模糊 / 饱和度 / 亮度 / 高光层）任何一项随交互变化，都会让用户
    // 觉得"点一下整屏变色"（v2.4.5 的高光层被撤掉就是这么翻车的）。
    let releaseTimer = 0;
    const engageLite = () => {
      if (!liquid) return;
      root.style.setProperty('--itdc-card-blur', liteCardBlur);
      root.style.setProperty('--itdc-nav-blur', liteNavBlur);
    };
    const releaseFull = () => {
      if (!liquid) return;
      root.style.setProperty('--itdc-card-blur', blur);
      root.style.setProperty('--itdc-nav-blur', navBlur);
    };
    const scheduleRelease = () => {
      window.clearTimeout(releaseTimer);
      releaseTimer = window.setTimeout(releaseFull, 180);
    };
    // 高光在移动 = 玻璃正在逐帧重绘：跟着降档，否则按住 / 倾斜时每帧重算折射滤镜会闪屏
    const onGlassMotion = () => {
      engageLite();
      scheduleRelease();
    };
    // 触摸的长按会被系统手势接管：Chrome 先发 pointercancel，但手指其实还按在屏幕上。
    // 此时若恢复折射，按着不动期间的高光重绘会逐帧重算滤镜，"长按透明区域连闪好几秒"
    // 就是这么来的——触摸序列的结束交给 touchend / touchcancel，pointercancel 只对鼠标/笔生效。
    const onPointerCancel = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      scheduleRelease();
    };
    window.addEventListener('pointerdown', engageLite, true);
    window.addEventListener('pointerup', scheduleRelease, true);
    window.addEventListener('pointercancel', onPointerCancel, true);
    window.addEventListener('touchend', scheduleRelease, true);
    window.addEventListener('touchcancel', scheduleRelease, true);
    window.addEventListener('scroll', engageLite, true);
    window.addEventListener('scroll', scheduleRelease, true);
    window.addEventListener('itdc-glass-motion', onGlassMotion, true);
    return () => {
      window.clearTimeout(releaseTimer);
      window.removeEventListener('pointerdown', engageLite, true);
      window.removeEventListener('pointerup', scheduleRelease, true);
      window.removeEventListener('pointercancel', onPointerCancel, true);
      window.removeEventListener('touchend', scheduleRelease, true);
      window.removeEventListener('touchcancel', scheduleRelease, true);
      window.removeEventListener('scroll', engageLite, true);
      window.removeEventListener('scroll', scheduleRelease, true);
      window.removeEventListener('itdc-glass-motion', onGlassMotion, true);
    };
  }, [appearance.bgImage, appearance.uiOpacity, appearance.uiBlur, appearance.liquidGlass, isDark]);

  // 镜面高光跟随设备运动：苹果的 Liquid Glass 高光会响应设备姿态与触摸。
  // 手机上用 deviceorientation（gamma/beta）映射高光位置；桌面/模拟器没有陀螺仪时退回指针位置。
  // 关键：两个输入源不能同时写同一个位置——按住手指时的微小抖动会让高光在
  // "手指坐标"和"设备姿态"两个位置之间反复横跳（这就是长按透明区域连闪的原因）。
  // 规则：手指按住期间由手指独占；陀螺仪可用时鼠标不抢；切换来源时用缓动过渡，不瞬移。
  useEffect(() => {
    if (!appearance.liquidGlass) return;
    const root = document.documentElement;
    // tx/ty = 目标位置（输入源给的值），cx/cy = 实际渲染的位置（向目标缓动）
    let tx = 26;
    let ty = 0;
    let cx = tx;
    let cy = ty;
    let raf = 0;
    // 上一次真正写入 CSS 的位置：变化不足 0.4% 不重绘（静止时省掉无谓刷新）
    let appliedX = cx;
    let appliedY = cy;
    /** 是否收到过陀螺仪数据（收到后鼠标让位，陀螺仪优先） */
    let gyroSeen = false;
    /** 手指是否按在屏幕上：按住期间高光归手指独占（长按被系统接管时 pointercancel
     *  会先到但手指没抬，所以只认 touchend / touchcancel / pointerup） */
    let touchHeld = false;
    const apply = () => {
      raf = 0;
      const k = 0.22; // 每帧向目标逼近 22%：跟手但不会瞬移
      cx += (tx - cx) * k;
      cy += (ty - cy) * k;
      const settled = Math.abs(tx - cx) < 0.25 && Math.abs(ty - cy) < 0.25;
      if (settled) { cx = tx; cy = ty; }
      if (Math.abs(cx - appliedX) >= 0.4 || Math.abs(cy - appliedY) >= 0.4 || settled) {
        appliedX = cx;
        appliedY = cy;
        root.style.setProperty('--itdc-spec-x', `${cx.toFixed(1)}%`);
        root.style.setProperty('--itdc-spec-y', `${cy.toFixed(1)}%`);
        // 通知主题层：高光在动 → 暂时去掉折射，避免逐帧重算滤镜闪屏
        window.dispatchEvent(new CustomEvent('itdc-glass-motion'));
      }
      if (!settled) schedule();
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };
    const setTarget = (nx: number, ny: number, threshold: number) => {
      if (Math.abs(nx - tx) < threshold && Math.abs(ny - ty) < threshold) return;
      tx = nx;
      ty = ny;
      schedule();
    };
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      gyroSeen = true;
      if (touchHeld) return; // 手指按住期间让位，避免两个来源打架
      // gamma：左右倾斜 -90..90 → 0..100%；beta：前后 -180..180（握持时约 40-60）
      setTarget(
        Math.max(0, Math.min(100, 50 + e.gamma * 0.9)),
        Math.max(0, Math.min(100, 50 + (e.beta - 45) * 1.2)),
        0.6, // 静止噪声（<0.6%）不重绘
      );
    };
    const onPointer = (e: PointerEvent) => {
      // 有陀螺仪时鼠标不再抢高光；触摸始终归当前手指
      if (e.pointerType !== 'touch' && gyroSeen) return;
      setTarget(
        Math.max(0, Math.min(100, (e.clientX / Math.max(1, window.innerWidth)) * 100)),
        Math.max(0, Math.min(100, (e.clientY / Math.max(1, window.innerHeight)) * 100)),
        0.6,
      );
    };
    const onPointerDown = (e: PointerEvent) => { if (e.pointerType === 'touch') touchHeld = true; };
    const onPointerUp = (e: PointerEvent) => { if (e.pointerType === 'touch') touchHeld = false; };
    const onTouchEnd = () => { touchHeld = false; };
    window.addEventListener('deviceorientation', onOrient);
    window.addEventListener('pointermove', onPointer);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('touchend', onTouchEnd, true);
    window.addEventListener('touchcancel', onTouchEnd, true);
    return () => {
      window.removeEventListener('deviceorientation', onOrient);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('touchend', onTouchEnd, true);
      window.removeEventListener('touchcancel', onTouchEnd, true);
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
