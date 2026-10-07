import { describe, it, expect } from 'vitest';
import { getHeader, mergeCookies } from './school-cas';

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
