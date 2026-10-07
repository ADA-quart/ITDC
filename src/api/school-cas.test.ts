import { describe, it, expect } from 'vitest';
import { getHeader, mergeCookies } from './school-cas';
import { resolveSectionsTime } from '../../shared/cdut-parser';

describe('getHeader', () => {
  it('大小写不敏感地取头（原生层三种写法都见过）', () => {
    expect(getHeader({ 'Set-Cookie': 'a=1' }, 'set-cookie')).toBe('a=1');
    expect(getHeader({ 'set-cookie': 'b=2' }, 'Set-Cookie')).toBe('b=2');
    expect(getHeader({ 'Set-cookie': 'c=3' }, 'SET-COOKIE')).toBe('c=3');
  });

  it('值是数组时按逗号拼接', () => {
    expect(getHeader({ Location: ['https://a', 'https://b'] }, 'location')).toBe('https://a, https://b');
  });

  it('没有该头返回 undefined', () => {
    expect(getHeader({ 'Content-Type': 'text/html' }, 'Location')).toBeUndefined();
    expect(getHeader(undefined, 'Location')).toBeUndefined();
  });
});

describe('mergeCookies', () => {
  it('追加新 cookie 并保留已有项', () => {
    expect(mergeCookies('a=1; b=2', ['c=3; Path=/; HttpOnly'])).toBe('a=1; b=2; c=3');
  });

  it('同名 cookie 覆盖为新值', () => {
    expect(mergeCookies('JSESSIONID=old', ['JSESSIONID=new; Path=/'])).toBe('JSESSIONID=new');
  });

  it('忽略 Expires/Path 等属性段，且不被 Expires 里的逗号切断', () => {
    const raw = 'SID=abc; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly';
    expect(mergeCookies('', [raw])).toBe('SID=abc');
  });

  it('原生层把多个 Set-Cookie 拼成一条时逐段解析', () => {
    const raw = 'a=1; Path=/, b=2; Path=/';
    expect(mergeCookies('', [raw])).toBe('a=1; b=2');
  });

  it('不把属性名当成 cookie', () => {
    expect(mergeCookies('', ['Path=/; HttpOnly'])).toBe('');
  });
});

describe('教务节次 → 真实时间', () => {
  it('09-10-11 节是 19:10-21:35（晚课第三节不能丢）', () => {
    expect(resolveSectionsTime('09-10-11节', 5)).toEqual({ start: '19:10', end: '21:35' });
  });

  it('第 11 小节单独上课时是 20:55-21:35', () => {
    expect(resolveSectionsTime('11节', 5)).toEqual({ start: '20:55', end: '21:35' });
  });

  it('05-06-07-08 节连堂 = 14:30-18:00', () => {
    expect(resolveSectionsTime('05-06-07-08节', 3)).toEqual({ start: '14:30', end: '18:00' });
  });

  it('普通两小节仍然按整大节算', () => {
    expect(resolveSectionsTime('03-04节', 1)).toEqual({ start: '10:15', end: '11:50' });
    expect(resolveSectionsTime('05-06节', 3)).toEqual({ start: '14:30', end: '16:05' });
    expect(resolveSectionsTime('09-10节', 5)).toEqual({ start: '19:10', end: '20:45' });
  });

  it('节次认不出来时回退到格子序号', () => {
    expect(resolveSectionsTime('', 3)).toEqual({ start: '14:30', end: '16:05' });
    expect(resolveSectionsTime('待定', 5)).toEqual({ start: '19:10', end: '20:45' });
  });
});
