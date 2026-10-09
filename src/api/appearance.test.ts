import { describe, it, expect } from 'vitest';
import { MIN_BG_ZOOM, sanitizeAppearance } from './appearance';

describe('sanitizeAppearance 背景焦点与缩放', () => {
  it('默认焦点居中、缩放 1 倍', () => {
    const s = sanitizeAppearance({});
    expect(s.bgFocusX).toBe(50);
    expect(s.bgFocusY).toBe(50);
    expect(s.bgZoom).toBe(1);
  });

  it('把越界焦点夹到 0-100', () => {
    const s = sanitizeAppearance({ bgFocusX: 200, bgFocusY: -20 });
    expect(s.bgFocusX).toBe(100);
    expect(s.bgFocusY).toBe(0);
  });

  it('界面透明度/模糊默认值并夹取范围', () => {
    const s = sanitizeAppearance({});
    expect(s.uiOpacity).toBe(62);
    expect(s.uiBlur).toBe(14);
    const clamped = sanitizeAppearance({ uiOpacity: 999, uiBlur: -5 });
    expect(clamped.uiOpacity).toBe(100);
    expect(clamped.uiBlur).toBe(0);
  });

  it('图片缩放默认 1 倍，越界夹到 0.5-3 倍（支持缩小）', () => {
    expect(sanitizeAppearance({}).bgZoom).toBe(1);
    expect(sanitizeAppearance({ bgZoom: 9 }).bgZoom).toBe(3);
    expect(sanitizeAppearance({ bgZoom: 0.2 }).bgZoom).toBe(MIN_BG_ZOOM);
    expect(sanitizeAppearance({ bgZoom: 0.8 }).bgZoom).toBe(0.8);
  });
});
