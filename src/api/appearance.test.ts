import { describe, it, expect } from 'vitest';
import { sanitizeAppearance } from './appearance';

describe('sanitizeAppearance 背景填充与焦点', () => {
  it('默认为铺满裁切、焦点居中', () => {
    const s = sanitizeAppearance({});
    expect(s.bgFit).toBe('cover');
    expect(s.bgFocusX).toBe(50);
    expect(s.bgFocusY).toBe(50);
  });

  it('保留完整显示，并把越界焦点夹到 0-100', () => {
    const s = sanitizeAppearance({ bgFit: 'contain', bgFocusX: 200, bgFocusY: -20 });
    expect(s.bgFit).toBe('contain');
    expect(s.bgFocusX).toBe(100);
    expect(s.bgFocusY).toBe(0);
  });

  it('非法填充方式回退铺满', () => {
    expect(sanitizeAppearance({ bgFit: 'stretch' as never }).bgFit).toBe('cover');
  });
});
