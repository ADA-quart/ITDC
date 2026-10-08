// 检查更新：查询 GitHub Releases 的最新版本并与当前版本比较。
//
// 只做提示，不强制更新，也不会自动下载。用户决定是否前往发布页。
// 直接请求 GitHub 的公开 API，因此不依赖服务器 —— 纯本机模式下同样可用。

const REPO = 'ADA-quart/ITDC';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

/** 失败原因分类，交由界面翻译，避免在此处写死文案 */
export type UpdateErrorKind = 'rate-limited' | 'http' | 'network' | 'parse';

export interface UpdateCheckResult {
  status: 'up-to-date' | 'update-available' | 'error';
  /** 当前版本（取自 package.json，构建时注入） */
  current: string;
  /** 最新版本号，去掉前缀 v */
  latest?: string;
  /** 发布页地址 */
  url?: string;
  publishedAt?: string;
  error?: UpdateErrorKind;
  httpStatus?: number;
}

export function getCurrentVersion(): string {
  try {
    return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * 检查结果缓存 10 分钟。
 *
 * GitHub 未认证接口按 IP 限流（每小时 60 次），我们发版又比较勤，
 * 用户连续点几下就可能撞上「查询过于频繁」，之后一小时都查不了。
 * 短时间内的重复点击直接复用上一次结果，不再打网络。
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { at: number; result: UpdateCheckResult } | null = null;

/** 清掉缓存（测试/手动强制刷新用） */
export function clearUpdateCache(): void {
  cache = null;
}

/** 把 "1.5.0" / "v1.5.0" / "1.5.0-beta.1" 解析成可比较的数字数组 */
function parseVersion(raw: string): number[] {
  const core = String(raw || '').trim().replace(/^v/i, '').split(/[-+]/)[0];
  return core.split('.').map((n) => {
    const v = parseInt(n, 10);
    return Number.isNaN(v) ? 0 : v;
  });
}

/** a > b 返回正数，相等返回 0，a < b 返回负数 */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  const len = Math.max(va.length, vb.length);
  for (let i = 0; i < len; i++) {
    const d = (va[i] ?? 0) - (vb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const current = getCurrentVersion();
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.result;
  }

  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });

    if (res.status === 403) {
      // GitHub 对未认证请求按 IP 限流（每小时 60 次）
      return remember({ status: 'error', current, error: 'rate-limited', httpStatus: 403 });
    }
    if (!res.ok) {
      return remember({ status: 'error', current, error: 'http', httpStatus: res.status });
    }

    const data = await res.json();
    const tag = String(data?.tag_name || '');
    const latest = tag.replace(/^v/i, '').trim();
    if (!latest) {
      return remember({ status: 'error', current, error: 'parse' });
    }

    return remember({
      status: compareVersions(latest, current) > 0 ? 'update-available' : 'up-to-date',
      current,
      latest,
      url: data?.html_url || RELEASES_PAGE,
      publishedAt: data?.published_at,
    });
  } catch {
    return remember({ status: 'error', current, error: 'network' });
  }
}

function remember(result: UpdateCheckResult): UpdateCheckResult {
  // 网络类失败不缓存：用户换网络/稍后重试应当真的重试
  if (result.status !== 'error' || result.error === 'rate-limited') {
    cache = { at: Date.now(), result };
  }
  return result;
}

export { RELEASES_PAGE };
