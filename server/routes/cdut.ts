import { Router, Request, Response as ExpressResponse } from 'express';
import { createHash, publicEncrypt, constants } from 'crypto';
import { parseTimetableHtml, parseSemesterOptions } from '../services/cdut-parser.js';
import { debug } from '../utils/debug.js';

const router = Router();

const CAS_BASE = 'https://cas.paas.cdut.edu.cn/cas';
const JW_BASE = 'https://jw.cdut.edu.cn';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36';

/**
 * 内存会话存储：sessionId → cookie 字符串。
 * 生产部署时可换 Redis；单机部署够用。
 */
const sessionStore = new Map<string, string>();

function newSessionId(): string {
  return createHash('sha256').update(Date.now().toString(36) + Math.random().toString(36)).digest('hex').slice(0, 24);
}

/** 从 Set-Cookie 响应头提取 cookie 键值对，拼进已有 cookie 串 */
function mergeCookies(existing: string, setCookieHeaders: string[]): string {
  const jar = new Map<string, string>();
  for (const kv of existing.split('; ').filter(Boolean)) {
    const eq = kv.indexOf('=');
    if (eq > 0) jar.set(kv.slice(0, eq), kv.slice(eq + 1));
  }
  for (const raw of setCookieHeaders) {
    const kv = raw.split(';')[0];
    const eq = kv.indexOf('=');
    if (eq > 0) jar.set(kv.slice(0, eq), kv.slice(eq + 1));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** 手动跟随重定向（禁用自动重定向以精确控制 cookie） */
async function fetchNoRedirect(url: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const { cookie, ...rest } = init;
  const headers = new Headers(rest.headers ?? {});
  if (cookie) headers.set('Cookie', cookie);
  headers.set('User-Agent', UA);
  headers.set('Referer', url);
  return fetch(url, { ...rest, headers, redirect: 'manual' });
}

/**
 * CAS 密码 RSA PKCS#1 加密
 */
async function encryptPassword(password: string): Promise<string> {
  if (password.startsWith('__RSA__')) return password;
  const res = await fetchNoRedirect(`${CAS_BASE}/jwt/publicKey`);
  const pem = await res.text();
  const encrypted = publicEncrypt(
    { key: pem.trim(), padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(password, 'utf8'),
  ).toString('base64');
  return `__RSA__${encrypted}`;
}

/** CAS 登录 + 教务 SSO，成功返回 cookie 串和学号 */
async function casLogin(username: string, password: string): Promise<{ cookie: string; studentId: string }> {
  // 1. 拿登录页 → execution
  const loginPageRes = await fetchNoRedirect(`${CAS_BASE}/login`);
  const loginCookies = mergeCookies('', loginPageRes.headers.getSetCookie());
  const loginPage = await loginPageRes.text();
  const executionM = /execution" value="(.*?)"/.exec(loginPage);
  if (!executionM) throw new Error('CAS 登录页解析失败（可能需要验证码）');

  // 2. RSA 加密密码
  const encryptedPwd = await encryptPassword(password);

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
  const loginRes = await fetchNoRedirect(`${CAS_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cookie: loginCookies,
  });
  const postCookies = mergeCookies(loginCookies, loginRes.headers.getSetCookie());
  const result = await loginRes.text();
  if (!result.includes('successRedirectUrl')) {
    throw new Error('CAS 登录失败：账号或密码错误');
  }
  const studentIdM = /<strong><span>(.*)<\/span>/.exec(result);
  const studentId = studentIdM?.[1] ?? '';

  // 4. 教务 SSO（手动跟随重定向，把 CAS ticket 交给教务）
  const jwCookie = await followJwSso(postCookies);
  return { cookie: jwCookie, studentId };
}

/** 教务系统 SSO：GET /sso/login.jsp → 循环跟随 302 直到拿到教务 session */
async function followJwSso(casCookie: string): Promise<string> {
  let cookie = '';
  let url = `${JW_BASE}/sso/login.jsp`;
  for (let i = 0; i < 10; i++) {
    const res = await fetchNoRedirect(url, { cookie: mergeCookies(cookie, casCookie.split('; ')) });
    cookie = mergeCookies(cookie, res.headers.getSetCookie());
    const location = res.headers.get('location');
    if (!location) break;
    url = location.startsWith('http') ? location : new URL(location, url).toString();
  }
  if (!cookie.includes('JSESSIONID')) {
    throw new Error('教务 SSO 认证失败');
  }
  return cookie;
}

/** 从课表页拿学期列表 */
async function fetchSemesters(cookie: string): Promise<string[]> {
  const res = await fetchNoRedirect(`${JW_BASE}/jsxsd/xskb/xskb_list.do`, { cookie });
  const html = await res.text();
  return parseSemesterOptions(html);
}

/** 抓取指定学期的完整课表 */
async function fetchTimetable(cookie: string, semester: string): Promise<string> {
  const body = new URLSearchParams({
    cj0701id: '',
    xnxq01id: semester,
    sfFD: '1',
    wkbkc: '1',
    zc: '',
  });
  const res = await fetchNoRedirect(`${JW_BASE}/jsxsd/xskb/xskb_list.do`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cookie,
  });
  if (!res.ok) throw new Error(`课表请求失败（HTTP ${res.status}）`);
  return res.text();
}

// ---------- API 路由 ----------

/** POST /api/cdut/login — 登录并返回 sessionId + 学期列表 */
router.post('/login', async (req: Request, res: ExpressResponse) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '学号和密码不能为空' });
  }
  try {
    const { cookie, studentId } = await casLogin(username, password);
    const sessionId = newSessionId();
    sessionStore.set(sessionId, cookie);
    const semesters = await fetchSemesters(cookie);
    debug.info('CDUT login', { studentId, semesters: semesters.length });
    res.json({ sessionId, studentId, semesters });
  } catch (err: any) {
    debug.error('CDUT login failed', { message: err?.message });
    res.status(401).json({ error: err?.message ?? '登录失败' });
  }
});

/** POST /api/cdut/timetable — 抓取指定学期课表，返回解析后的课程数组 */
router.post('/timetable', async (req: Request, res: ExpressResponse) => {
  const { sessionId, semester } = req.body;
  const cookie = sessionId ? sessionStore.get(sessionId) : undefined;
  if (!cookie) {
    return res.status(401).json({ error: '会话已过期，请重新登录' });
  }
  if (!semester) {
    return res.status(400).json({ error: '请选择学期' });
  }
  try {
    const html = await fetchTimetable(cookie, semester);
    const courses = parseTimetableHtml(html);
    debug.info('CDUT timetable fetched', { semester, count: courses.length });
    res.json({ courses });
  } catch (err: any) {
    debug.error('CDUT timetable failed', { message: err?.message });
    res.status(500).json({ error: err?.message ?? '课表获取失败' });
  }
});

export default router;
