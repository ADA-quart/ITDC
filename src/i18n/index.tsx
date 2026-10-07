import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import zh, { LocaleMessages } from './zh';
import en from './en';

type Locale = 'zh' | 'en';

const messages: Record<Locale, LocaleMessages> = { zh, en };

/**
 * 启动时就定好语言，不能只放在 useEffect 里。
 *
 * dayjs 的全局 locale 决定了星期/月份名字（"Mon" vs "周一"、"August" vs "8月"），
 * 它的默认值是英文。放在 effect 里要等首帧渲染完才生效，于是每次冷启动
 * 都会先闪一下英文——课表格子和 antd 日期面板尤其明显，看起来像"偶发中英文混排"。
 */
function readInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem('locale');
    return saved === 'en' ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

const initialLocale = readInitialLocale();
dayjs.locale(initialLocale === 'zh' ? 'zh-cn' : 'en');
// 同一批：<html lang> 与标题也先定好，别等 effect
if (typeof document !== 'undefined') {
  document.documentElement.lang = initialLocale === 'zh' ? 'zh-CN' : 'en';
}

interface I18nContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: LocaleMessages;
}

const I18nContext = createContext<I18nContextType>({
  locale: 'zh',
  setLocale: () => {},
  t: zh,
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem('locale', l);
  }, []);

  const t = messages[locale];

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    document.title = locale === 'zh' ? '智能日历与待办规划' : 'Smart Calendar & Todo Planner';
    // antd 的日期/时间面板月份与星期名来自 dayjs 的 locale（不是 ConfigProvider）。
    // 首帧用的值已经在模块顶层设好，这里只管用户手动切换语言后的更新。
    dayjs.locale(locale === 'zh' ? 'zh-cn' : 'en');
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export function useI18n() {
  return useContext(I18nContext);
}
