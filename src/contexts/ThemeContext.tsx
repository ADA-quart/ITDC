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
