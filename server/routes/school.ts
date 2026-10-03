import { Router, Request, Response as ExpressResponse } from 'express';
import { createHash, publicEncrypt, constants } from 'crypto';
import { parseTimetableHtml, parseSemesterOptions } from '../../shared/cdut-parser.js';
import { getSchool, SCHOOLS } from '../../shared/schools.js';
import { debug } from '../utils/debug.js';

const router = Router();

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36';

/**
 * 内存会话存储：sessionId → { schoolId, cookie }。
 * 生产部署时可换 Redis；单机部署够用。
 */
interface StoredSession { schoolId: string; cookie: string; }
const sessionStore = new Map<string, StoredSession>();

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
async function encryptPassword(casBase: string, password: string): Promise<string> {
  if (password.startsWith('__RSA__')) return password;
  const res = await fetchNoRedirect(`${casBase}/jwt/publicKey`);
  const pem = await res.text();
  const encrypted = publicEncrypt(
    { key: pem.trim(), padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(password, 'utf8'),
  ).toString('base64');
  return `__RSA__${encrypted}`;
}

/** CAS 登录 + 教务 SSO，成功返回 cookie 串和学号 */
async function casLogin(schoolId: string, username: string, password: string): Promise<{ cookie: string; studentId: string }> {
  const school = getSchool(schoolId);
  if (!school) throw new Error('不支持的学校');

  // 1. 拿登录页 → execution
  const loginPageRes = await fetchNoRedirect(`${school.casBase}/login`);
  const loginCookies = mergeCookies('', loginPageRes.headers.getSetCookie());
  const loginPage = await loginPageRes.text();
  const executionM = /execution" value="(.*?)"/.exec(loginPage);
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
  const loginRes = await fetchNoRedirect(`${school.casBase}/login`, {
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
  const jwCookie = await followJwSso(school, postCookies);
  return { cookie: jwCookie, studentId };
}

/** 教务系统 SSO：GET /sso/login.jsp → 循环跟随 302 直到拿到教务 session */
async function followJwSso(school: NonNullable<ReturnType<typeof getSchool>>, casCookie: string): Promise<string> {
  let cookie = '';
  let url = `${school.jwBase}${school.jwSsoPath}`;
  for (let i = 0; i < school.ssoMaxRedirects; i++) {
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
async function fetchSemesters(school: NonNullable<ReturnType<typeof getSchool>>, cookie: string): Promise<string[]> {
  const res = await fetchNoRedirect(`${school.jwBase}${school.timetablePath}`, { cookie });
  const html = await res.text();
  return parseSemesterOptions(html);
}

/** 抓取指定学期的完整课表 */
async function fetchTimetable(school: NonNullable<ReturnType<typeof getSchool>>, cookie: string, semester: string): Promise<string> {
  const body = new URLSearchParams({
    cj0701id: '',
    xnxq01id: semester,
    sfFD: '1',
    wkbkc: '1',
    zc: '',
  });
  const res = await fetchNoRedirect(`${school.jwBase}${school.timetablePath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cookie,
  });
  if (!res.ok) throw new Error(`课表请求失败（HTTP ${res.status}）`);
  return res.text();
}

// ---------- API 路由 ----------

/** GET /api/school — 已支持学校列表（前端下拉用） */
router.get('/', (_req: Request, res: ExpressResponse) => {
  res.json({ schools: Object.values(SCHOOLS).map(({ id, name }) => ({ id, name })) });
});

/** POST /api/school/login — 登录指定学校并返回 sessionId + 学期列表 */
router.post('/login', async (req: Request, res: ExpressResponse) => {
  const { schoolId, username, password } = req.body;
  if (!schoolId || !SCHOOLS[schoolId]) {
    return res.status(400).json({ error: '请选择支持的学校' });
  }
  if (!username || !password) {
    return res.status(400).json({ error: '学号和密码不能为空' });
  }
  try {
    const { cookie, studentId } = await casLogin(schoolId, username, password);
    const sessionId = newSessionId();
    sessionStore.set(sessionId, { schoolId, cookie });
    const school = SCHOOLS[schoolId];
    const semesters = await fetchSemesters(school, cookie);
    debug.info('school login', { schoolId, studentId, semesters: semesters.length });
    res.json({ sessionId, studentId, semesters });
  } catch (err: any) {
    debug.error('school login failed', { schoolId, message: err?.message });
    res.status(401).json({ error: err?.message ?? '登录失败' });
  }
});

/** POST /api/school/timetable — 抓取指定学期课表，返回解析后的课程数组 */
router.post('/timetable', async (req: Request, res: ExpressResponse) => {
  const { sessionId, semester } = req.body;
  const session = sessionId ? sessionStore.get(sessionId) : undefined;
  if (!session) {
    return res.status(401).json({ error: '会话已过期，请重新登录' });
  }
  if (!semester) {
    return res.status(400).json({ error: '请选择学期' });
  }
  const school = SCHOOLS[session.schoolId];
  try {
    const html = await fetchTimetable(school, session.cookie, semester);
    const courses = parseTimetableHtml(html);
    debug.info('school timetable fetched', { schoolId: session.schoolId, semester, count: courses.length });
    res.json({ courses });
  } catch (err: any) {
    debug.error('school timetable failed', { schoolId: session.schoolId, message: err?.message });
    res.status(500).json({ error: err?.message ?? '课表获取失败' });
  }
});

export default router;
