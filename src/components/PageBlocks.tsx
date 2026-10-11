// © 2026 ADA-Quart & TyTs · 日日新（ITDC）· PolyForm Noncommercial 1.0.0 · github.com/ADA-quart/ITDC

import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { secondaryTextColor } from './ui';

/**
 * 「日日新」排版件：把全 App 的页头与分节标题收进同一套样式，形成统一识别度。
 *
 * 依据（手机 UI 研究）：视觉复杂度与美观评价负相关（Michailidou 2008 / Tuch 2012 /
 * Seckler 2015，Frontiers 2023 综述）——所以这里只做"一根主题色小色条 + 常规字阶"，
 * 不加大色块、不加多余装饰；信息层级靠字重与间距，而不是靠更多颜色。
 */

interface SectionTitleProps {
  children: React.ReactNode;
  /** 可选的一行说明，12px 次级文字 */
  hint?: React.ReactNode;
  /** 右侧动作区（例如一个小按钮/开关） */
  right?: React.ReactNode;
  style?: React.CSSProperties;
}

/** 分节标题：主题色小色条 + 标题（+说明 / 右侧动作），全 App 同款 */
export const SectionTitle: React.FC<SectionTitleProps> = ({ children, hint, right, style }) => {
  const { isDark, appearance } = useTheme();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 8,
        margin: '0 0 10px',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {/* 排版签名：一根 4×16 的主题色小色条 */}
        <span
          aria-hidden
          style={{
            width: 4,
            height: 16,
            borderRadius: 2,
            background: appearance.accent,
            flexShrink: 0,
          }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, lineHeight: '20px' }}>{children}</div>
          {hint ? (
            <div style={{ fontSize: 12, color: secondaryTextColor(isDark), marginTop: 2 }}>{hint}</div>
          ) : null}
        </div>
      </div>
      {right ? <div style={{ flexShrink: 0 }}>{right}</div> : null}
    </div>
  );
};

interface PageHeaderProps {
  title: React.ReactNode;
  caption?: React.ReactNode;
  right?: React.ReactNode;
  style?: React.CSSProperties;
}

/** 页面标题：大一档（19px/700）+ 可选的 12px 说明；页面顶部专用 */
export const PageHeader: React.FC<PageHeaderProps> = ({ title, caption, right, style }) => {
  const { isDark } = useTheme();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        margin: '2px 0 14px',
        ...style,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 19, fontWeight: 700, lineHeight: '26px' }}>{title}</div>
        {caption ? (
          <div style={{ fontSize: 12, color: secondaryTextColor(isDark), marginTop: 2 }}>{caption}</div>
        ) : null}
      </div>
      {right ? <div style={{ flexShrink: 0 }}>{right}</div> : null}
    </div>
  );
};
