import { describe, it, expect } from 'vitest';
import { compareVersions } from './update-check';

describe('compareVersions', () => {
  it('相等的版本返回 0', () => {
    expect(compareVersions('1.5.0', '1.5.0')).toBe(0);
    expect(compareVersions('v1.5.0', '1.5.0')).toBe(0);
  });

  it('识别更新', () => {
    expect(compareVersions('1.5.1', '1.5.0')).toBeGreaterThan(0);
    expect(compareVersions('1.6.0', '1.5.9')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
  });

  it('识别旧版本', () => {
    expect(compareVersions('1.4.9', '1.5.0')).toBeLessThan(0);
    expect(compareVersions('1.5.0', '1.5.1')).toBeLessThan(0);
  });

  it('忽略 v 前缀', () => {
    expect(compareVersions('v2.0.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', 'v1.0.0')).toBeGreaterThan(0);
  });

  it('位数不同时按缺位补 0', () => {
    expect(compareVersions('1.5', '1.5.0')).toBe(0);
    expect(compareVersions('1.5.1', '1.5')).toBeGreaterThan(0);
  });

  it('预发布后缀只比较主版本号', () => {
    // 1.6.0-beta 的主版本高于 1.5.0，仍应识别为更新
    expect(compareVersions('1.6.0-beta.1', '1.5.0')).toBeGreaterThan(0);
    expect(compareVersions('1.5.0-rc.1', '1.5.0')).toBe(0);
  });

  it('非法输入不抛异常', () => {
    expect(() => compareVersions('', '1.0.0')).not.toThrow();
    expect(() => compareVersions('abc', '1.0.0')).not.toThrow();
    expect(compareVersions('', '1.0.0')).toBeLessThan(0);
  });
});
