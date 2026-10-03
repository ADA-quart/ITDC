/**
 * 学校教务课表导入 — 本地直连 CAS 层（Capacitor 原生 HTTP）
 *
 * 原生 App 内直接与学校统一认证（CAS）+ 教务系统通信，不依赖中转服务器；
 * Web 端仍走 src/api/client.ts 的 schoolApi（同源 /api/school）。
 *
 * 流程移植自 server/routes/school.ts：
 *   1. GET CAS /login → 提取 execution + Set-Cookie
 *   2. GET CAS /jwt/publicKey → RSA PKCS#1 加密密码（jsencrypt）
 *   3. POST CAS /login → 判 successRedirectUrl → 提取学号
 *   4. GET 教务 /sso/login.jsp → 循环跟随 302 合并 cookie 直到拿到 JSESSIONID
 *   5. GET/POST 教务课表页 → shared/cdut-parser 解析
 *
 * Capacitor 原生 HTTP 不自动管理 cookie，需手动维护 jar；
 * 响应头 Set-Cookie 由原生层以逗号拼接返回，按分号分段后取首段 k=v。
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { JSEncrypt } from 'jsencrypt';
import { parseTimetableHtml, parseSemesterOptions, type CdutCourse } from '../../shared/cdut-parser';
import { getSchool, type SchoolConfig } from '../../shared/schools';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36';

/** 原生平台且 CapacitorHttp 可用 → 走本地直连 */
export function isNativeHttpAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

// ---------- cookie jar ----------

let cookieJar = '';

function mergeCookies(existing: string, setCookieRaw: string | string[] | undefined): string {
  const jar = new Map<string, string>();
  for (const kv of existing.split('; ').filter(Boolean)) {
    const eq = kv.indexOf('=');
    if (eq > 0) jar.set(kv.slice(0, eq), kv.slice(eq + 1));
  }
  // 原生层把多个 Set-Cookie 以 ", " 拼成一条；Expires 值本身含逗号，
  // 先按 "; " 分段，再对每段取首个 "=" 前的键名（跳过 Expires/Path 等属性段）
  const raws = Array.isArray(setCookieRaw) ? setCookieRaw : String(setCookieRaw ?? '').split(', ');
  for (const raw of raws) {
    for (const seg of raw.split(/(?<=, )/)) {
      const first = seg.trim().split(';')[0];
      const eq = first.indexOf('=');
      if (eq <= 0) continue;
      const key = first.slice(0, eq).trim();
      if (/^(Expires|Max-Age|Path|Domain|Secure|HttpOnly|SameSite)$/i.test(key)) continue;
      jar.set(key, first.slice(eq + 1).trim());
    }
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

// ---------- 原生 HTTP 封装 ----------

interface NoRedirectResult {
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
}

async function requestNoRedirect(
  url: string,
  opts: { method?: 'GET' | 'POST'; body?: URLSearchParams; cookie?: string } = {},
): Promise<NoRedirectResult> {
  const headers: Record<string, string> = { 'User-Agent': UA, Referer: url };
  if (opts.cookie) headers['Cookie'] = opts.cookie;
  const data = opts.body?.toString();
  if (data) headers['Content-Type'] = 'application/x-www-form-urlencoded';

  const res = await CapacitorHttp.request({
    url,
    method: opts.method ?? 'GET',
    headers,
    data,
    // 原生层手动跟随，便于逐步合并 cookie
    disableRedirects: true,
    readTimeout: 15000,
    connectTimeout: 15000,
  });
  return { status: res.status, headers: res.headers, body: typeof res.data === 'string' ? res.data : String(res.data ?? '') };
}

// ---------- CAS 登录 ----------

async function encryptPassword(casBase: string, password: string): Promise<string> {
  if (password.startsWith('__RSA__')) return password;
  const res = await requestNoRedirect(`${casBase}/jwt/publicKey`);
  const pem = res.body.trim();
  const encrypt = new JSEncrypt();
  encrypt.setPublicKey(pem);
  const encrypted = encrypt.encrypt(password);
  if (!encrypted) throw new Error('密码加密失败（公钥无效）');
  return `__RSA__${encrypted}`;
}

interface LocalLoginResult {
  studentId: string;
  semesters: string[];
}

/** CAS 登录 + 教务 SSO + 拉学期列表；cookie 留在模块级 jar 中 */
async function casLogin(school: SchoolConfig, username: string, password: string): Promise<LocalLoginResult> {
  cookieJar = '';

  // 1. 登录页 → execution
  const loginPageRes = await requestNoRedirect(`${school.casBase}/login`);
  cookieJar = mergeCookies(cookieJar, loginPageRes.headers['Set-Cookie'] ?? loginPageRes.headers['set-cookie']);
  const executionM = /execution" value="(.*?)"/.exec(loginPageRes.body);
  if (!executionM) throw new Error('CAS 登录页解析失败（可能需要验证码）');

  // 2. RSA 加密密码
  const encryptedPwd = await encryptPassword(school.casBase, password);

  // 3. POST 登录
  const body = new URLSearchParams({
    username,
    password: encryptedPwd,
    captcha: '',
    rememberMe: 'true',
    currentMenu: '1',
    failN: '0',
    mfaState: '',
    execution: executionM[1],
    _eventId: 'submit',
    geolocation: '',
    submit1: 'Login1',
  });
  const loginRes = await requestNoRedirect(`${school.casBase}/login`, {
    method: 'POST',
    body,
    cookie: cookieJar,
  });
  cookieJar = mergeCookies(cookieJar, loginRes.headers['Set-Cookie'] ?? loginRes.headers['set-cookie']);
  if (!loginRes.body.includes('successRedirectUrl')) {
    throw new Error('CAS 登录失败：账号或密码错误');
  }
  const studentIdM = /<strong><span>(.*)<\/span>/.exec(loginRes.body);
  const studentId = studentIdM?.[1] ?? '';

  // 4. 教务 SSO：跟随 302 直到无 Location 或拿到 JSESSIONID
  const casCookies = cookieJar.split('; ').filter(Boolean);
  let ssoCookie = '';
  let url = `${school.jwBase}${school.jwSsoPath}`;
  for (let i = 0; i < school.ssoMaxRedirects; i++) {
    const res = await requestNoRedirect(url, { cookie: mergeCookies(ssoCookie, casCookies) });
    ssoCookie = mergeCookies(ssoCookie, res.headers['Set-Cookie'] ?? res.headers['set-cookie']);
    const location = (res.headers['Location'] ?? res.headers['location']) as string | undefined;
    if (!location) break;
    url = location.startsWith('http') ? location : new URL(location, url).toString();
  }
  if (!ssoCookie.includes('JSESSIONID')) {
    throw new Error('教务 SSO 认证失败');
  }
  cookieJar = ssoCookie;

  // 5. 拉学期列表
  const semesterRes = await requestNoRedirect(`${school.jwBase}${school.timetablePath}`, { cookie: cookieJar });
  const semesters = parseSemesterOptions(semesterRes.body);
  return { studentId, semesters };
}

// ---------- 课表抓取 ----------

async function fetchTimetable(school: SchoolConfig, semester: string): Promise<CdutCourse[]> {
  const body = new URLSearchParams({
    cj0701id: '',
    xnxq01id: semester,
    sfFD: '1',
    wkbkc: '1',
    zc: '',
  });
  const res = await requestNoRedirect(`${school.jwBase}${school.timetablePath}`, {
    method: 'POST',
    body,
    cookie: cookieJar,
  });
  if (res.status >= 400) throw new Error(`课表请求失败（HTTP ${res.status}）`);
  return parseTimetableHtml(res.body);
}

// ---------- 对外 API ----------

export const localSchoolApi = {
  /** 本地直连登录；返回学号和学期列表（无 sessionId 概念，cookie 存内存） */
  async login(schoolId: string, username: string, password: string): Promise<LocalLoginResult> {
    const school = getSchool(schoolId);
    if (!school) throw new Error('不支持的学校');
    return casLogin(school, username, password);
  },

  /** 本地直连抓课表；semester 由 login 返回的列表中选择 */
  async timetable(schoolId: string, semester: string): Promise<{ courses: CdutCourse[] }> {
    const school = getSchool(schoolId);
    if (!school) throw new Error('不支持的学校');
    return { courses: await fetchTimetable(school, semester) };
  },
};

