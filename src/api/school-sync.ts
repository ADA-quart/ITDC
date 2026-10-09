// 教务课表「更新 / 自动同步」：用记住的账号自动登录，拉取上次的学期与开学周，
// 覆盖导入同名校历。手动「更新课表」与「每天首次打开自动同步」共用这条链路。
//
// 为什么不做"精确每天早上 6 点后台拉取"：Android 后台限制 + 国产 ROM 冻结
// 让定时后台执行不可靠；「每天首次打开时同步」在体验上等效，且不依赖特权。
import { Capacitor } from '@capacitor/core';
import dayjs from 'dayjs';
import { schoolApi, calendarApi } from './client';
import { localSchoolApi } from './school-cas';
import { loadSchoolCreds } from './school-creds';
import { getSelectedSchool } from './school-prefs';
import { getCalendarCache } from './offline';
import { buildEvents } from '../../shared/school-import';

const LAST_SEMESTER_KEY = 'itdc_school_last_semester';
const LAST_WEEK_START_KEY = 'itdc_school_last_week_start';
const LAST_SYNC_DATE_KEY = 'itdc_school_last_sync_date';
const AUTO_SYNC_KEY = 'itdc_school_auto_sync';

/** 导入成功后记录"上次的学期与开学周"，供更新 / 自动同步复用 */
export function saveSyncContext(semester: string, weekStartIso: string): void {
  try {
    localStorage.setItem(LAST_SEMESTER_KEY, semester);
    localStorage.setItem(LAST_WEEK_START_KEY, weekStartIso);
  } catch { /* 忽略存储失败 */ }
}

/** 自动同步开关（默认开：记住账号的用户多半想要课表常新） */
export function getAutoSyncEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_SYNC_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setAutoSyncEnabled(on: boolean): void {
  try { localStorage.setItem(AUTO_SYNC_KEY, String(on)); } catch { /* 忽略 */ }
}

export interface SchoolSyncResult {
  courses: number;
  semester: string;
}

/** 用记住的账号重新拉取并覆盖导入课表；silent 模式下条件不满足或失败都返回 null */
export async function syncSchoolTimetable(opts: { silent?: boolean } = {}): Promise<SchoolSyncResult | null> {
  const schoolId = (await getSelectedSchool()) || 'cdut';
  const creds = await loadSchoolCreds(schoolId);
  let semester = '';
  let weekStartIso = '';
  try {
    semester = localStorage.getItem(LAST_SEMESTER_KEY) || '';
    weekStartIso = localStorage.getItem(LAST_WEEK_START_KEY) || '';
  } catch { /* 读不到按未导入处理 */ }
  if (!creds || !semester || !weekStartIso) {
    if (opts.silent) return null;
    throw new Error('还没有可同步的信息：请先用「导入教务课表」登录并导入一次');
  }

  const isNative = Capacitor.isNativePlatform();
  const login = isNative
    ? { sessionId: 'local', ...(await localSchoolApi.login(schoolId, creds.username, creds.password)) }
    : await schoolApi.login(schoolId, creds.username, creds.password);
  // 学期若已不在教务列表里（学期切换），回退到最新学期
  const targetSemester = login.semesters.includes(semester) ? semester : (login.semesters[0] || semester);
  const r = isNative && login.sessionId === 'local'
    ? await localSchoolApi.timetable(schoolId, targetSemester)
    : await schoolApi.timetable(login.sessionId, targetSemester);
  if (r.courses.length === 0) {
    if (opts.silent) return null;
    throw new Error('教务里该学期还没有课程');
  }

  const events = buildEvents(r.courses, new Date(weekStartIso), schoolId);
  // 与手动导入一致：先删同名的旧教务日历（连同旧事件）再重建
  const existing = (await getCalendarCache()).find(
    (c) => c.name === `教务课表 ${targetSemester}` && c.source === schoolId
  );
  if (existing) await calendarApi.delete(existing.id);
  const newCalendar = await calendarApi.create({ name: `教务课表 ${targetSemester}`, color: '#722ed1', source: schoolId });
  const after = await getCalendarCache();
  const newCal = after.find((c) => c.sync_uid === newCalendar.sync_uid) ?? newCalendar;
  for (const ev of events) {
    await calendarApi.createEvent({ ...ev, calendar_id: newCal.id, calendar_name: newCal.name, calendar_color: newCal.color });
  }

  try { localStorage.setItem(LAST_SYNC_DATE_KEY, dayjs().format('YYYY-MM-DD')); } catch { /* 忽略 */ }
  window.dispatchEvent(new CustomEvent('todo-data-changed'));
  return { courses: events.length, semester: targetSemester };
}

/** 每天早上首次打开 App 时静默同步一次（同一天只跑一次；失败静默） */
export async function maybeAutoSyncDaily(): Promise<void> {
  if (!getAutoSyncEnabled()) return;
  try {
    if (localStorage.getItem(LAST_SYNC_DATE_KEY) === dayjs().format('YYYY-MM-DD')) return;
  } catch { /* 存不进就照跑 */ }
  try {
    await syncSchoolTimetable({ silent: true });
  } catch { /* 自动同步失败不打扰用户 */ }
}
