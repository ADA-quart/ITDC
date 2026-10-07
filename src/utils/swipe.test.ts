import { describe, it, expect } from 'vitest';
import { swipeDirection } from './swipe';

describe('swipeDirection', () => {
  it('向左滑是下一页，向右滑是上一页', () => {
    expect(swipeDirection(-120, 5)).toBe('next');
    expect(swipeDirection(120, 5)).toBe('prev');
  });

  it('位移太小不算翻页（点按、抖动）', () => {
    expect(swipeDirection(-20, 0)).toBeNull();
    expect(swipeDirection(30, 2)).toBeNull();
  });

  it('纵向为主的滑动不翻页（留给课表滚动）', () => {
    expect(swipeDirection(-80, 100)).toBeNull();
    expect(swipeDirection(70, -90)).toBeNull();
  });

  it('斜向但横向明显占优时仍然翻页', () => {
    expect(swipeDirection(-150, 40)).toBe('next');
  });

  it('阈值可调', () => {
    expect(swipeDirection(-40, 0, 30)).toBe('next');
    expect(swipeDirection(-40, 0, 60)).toBeNull();
  });
});
