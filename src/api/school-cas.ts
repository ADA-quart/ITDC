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
 * Cookie 走两手准备：Capacitor 会装一个全局 CookieHandler（原生层自动收发 Cookie），
 * 同时我们自己在 JS 侧维护一份 jar 并显式回传，避免某些机型上 CookieHandler 缺失时流程断掉。
 * 响应头 Set-Cookie 由原生层以逗号拼接返回，按分号分段后取首段 k=v。
 */
import { Capacitor, CapacitorHttp, CapacitorCookies } from '@capacitor/core';
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

/** 解析 Set-Cookie（原生层可能把多条用 ", " 拼成一条），返回 k=v 列表并跳过属性段 */
export function parseSetCookies(setCookieRaw: string | string[] | undefined): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (!setCookieRaw) return out;
  const raws = Array.isArray(setCookieRaw) ? setCookieRaw : String(setCookieRaw ?? '').split(', ');
  for (const raw of raws) {
    for (const seg of raw.split(/(?<=, )/)) {
      const first = seg.trim().split(';')[0];
      const eq = first.indexOf('=');
      if (eq <= 0) continue;
      const key = first.slice(0, eq).trim();
      if (/^(Expires|Max-Age|Path|Domain|Secure|HttpOnly|SameSite)$/i.test(key)) continue;
      out.push([key, first.slice(eq + 1).trim()]);
    }
  }
  return out;
}

export function mergeCookies(existing: string, setCookieRaw: string | string[] | undefined): string {
  const jar = new Map<string, string>();
  for (const kv of existing.split('; ').filter(Boolean)) {
    const eq = kv.indexOf('=');
    if (eq > 0) jar.set(kv.slice(0, eq), kv.slice(eq + 1));
  }
  for (const [key, value] of parseSetCookies(setCookieRaw)) jar.set(key, value);
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * 记录响应里的 Cookie。
 *
 * 除了 JS 侧 jar，还必须显式写进 Capacitor 的 Cookie 存储：
 * Android 的 HttpURLConnection(okhttp) 在装了全局 CookieHandler 时**会用自己的 Cookie
 * 覆盖我们手写的 Cookie 头**，所以只维护 JS jar 在真机上等于没发 Cookie —— 之前
 * 「登录页拿到了、POST 却提示密码错误 / SSO 拿不到 JSESSIONID」就是这么来的。
 */
async function captureCookies(url: string, headers: Record<string, string | string[]> | undefined): Promise<void> {
  const pairs = parseSetCookies(getHeader(headers, 'Set-Cookie'));
  if (pairs.length === 0) return;
  cookieJar = mergeCookies(cookieJar, pairs.map(([k, v]) => `${k}=${v}`).join('; '));
  for (const [key, value] of pairs) {
    try {
      await CapacitorCookies.setCookie({ url, key, value });
    } catch { /* 浏览器端没有该 API，忽略 */ }
  }
}

/**
 * 大小写不敏感地取响应头。
 * 原生层返回的键大小写不保证一致（见过 Set-Cookie / set-cookie / Set-cookie 三种），
 * 之前只匹配前两种，一旦命中不了就会「拿不到 Cookie」→ SSO 失败。
 */
export function getHeader(headers: Record<string, string | string[]> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const want = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== want) continue;
    const value = headers[key];
    return Array.isArray(value) ? value.join(', ') : String(value ?? '');
  }
  return undefined;
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
  // 把走过的步骤记下来，失败时一并抛出——手机上没法看控制台，错误信息必须自带上下文
  const trace: string[] = [];
  const step = (msg: string) => { trace.push(msg); if (trace.length > 8) trace.shift(); };
  // 用函数声明：带 never 返回类型，TS 才能把后续代码判定为不可达（也省掉多余的非空断言）
  function fail(msg: string): never {
    throw new Error(`${msg}｜步骤：${trace.join(' → ')}`);
  }

  // 清掉上一次失败留下的旧会话：残留的过期 JSESSIONID 会让 CAS 认为 execution 与会话不匹配，
  // 表现为「之后每次登录都失败」，重启 App 也不恢复。
  try {
    await CapacitorCookies.clearAllCookies();
  } catch { /* 桌面浏览器没有该 API，忽略 */ }

  // 1. 登录页 → execution
  const loginPageRes = await requestNoRedirect(`${school.casBase}/login`);
  step(`登录页 HTTP ${loginPageRes.status}`);
  await captureCookies(`${school.casBase}/login`, loginPageRes.headers);
  const executionM = /execution" value="(.*?)"/.exec(loginPageRes.body);
  if (!executionM) {
    if (loginPageRes.status !== 200) fail(`CAS 登录页请求失败（HTTP ${loginPageRes.status}）`);
    fail('登录页里没有 execution 字段（可能被安全策略拦截或需要验证码）');
  }

  // 2. RSA 加密密码
  let encryptedPwd: string;
  try {
    encryptedPwd = await encryptPassword(school.casBase, password);
    step('密码加密 OK');
  } catch (err: any) {
    fail(`密码加密失败：${err?.message ?? err}`);
  }

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
  await captureCookies(`${school.casBase}/login`, loginRes.headers);
  const loginLocation = getHeader(loginRes.headers, 'Location') ?? '';
  step(`登录 POST HTTP ${loginRes.status}`);
  // 成功标志：返回体带 successRedirectUrl（200 + JS 跳转页），或 302 且 Location 里带 ticket
  const loginOk =
    loginRes.body.includes('successRedirectUrl') ||
    (/^3\d\d$/.test(String(loginRes.status)) && /ticket=/i.test(loginLocation));
  if (!loginOk) {
    const hint = /(用户名或密码错误|密码错误|用户名不存在|验证码|校验失败|频繁|锁定)/.exec(loginRes.body)?.[1];
    fail(hint ? `CAS 登录失败：${hint}` : `CAS 登录失败（HTTP ${loginRes.status}，未返回成功标记）`);
  }
  const studentIdM = /<strong><span>(.*)<\/span>/.exec(loginRes.body);
  // 学号就是 CAS 用户名；某些跳转流程拿不到页面里的学号，退回用用户名
  const studentId = studentIdM?.[1] ?? username;

  // 4. 教务 SSO：跟随 302 直到无 Location 或拿到 JSESSIONID
  let url = `${school.jwBase}${school.jwSsoPath}`;
  let hops = 0;
  for (let i = 0; i < school.ssoMaxRedirects; i++) {
    const res = await requestNoRedirect(url, { cookie: cookieJar });
    await captureCookies(url, res.headers);
    hops++;
    const location = getHeader(res.headers, 'Location');
    if (!location) break;
    url = location.startsWith('http') ? location : new URL(location, url).toString();
  }
  step(`教务 SSO 跳转 ${hops} 次`);
  if (!cookieJar.includes('JSESSIONID')) {
    fail('教务系统未返回 JSESSIONID（票据没被接受或 Cookie 被丢弃）');
  }

  // 5. 拉学期列表
  const semesterRes = await requestNoRedirect(`${school.jwBase}${school.timetablePath}`, { cookie: cookieJar });
  step(`课表页 HTTP ${semesterRes.status}`);
  const semesters = parseSemesterOptions(semesterRes.body);
  if (semesters.length === 0) {
    const loggedOut = /Logon\.do|请重新登录|登录超时|用户登录/.test(semesterRes.body);
    fail(loggedOut ? '教务会话未生效，请重试' : '课表页没有解析出学期列表');
  }
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
