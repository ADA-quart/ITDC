import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import zh, { LocaleMessages } from './zh';
import en from './en';

type Locale = 'zh' | 'en';

const messages: Record<Locale, LocaleMessages> = { zh, en };

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
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved = localStorage.getItem('locale');
    return (saved === 'en' || saved === 'zh') ? saved : 'zh';
  });

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem('locale', l);
  }, []);

  const t = messages[locale];

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    document.title = locale === 'zh' ? '智能日历与待办规划' : 'Smart Calendar & Todo Planner';
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
