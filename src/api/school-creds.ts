/**
 * 教务账号的「记住」开关与凭据存取。
 *
 * 账号存 localStorage，密码交给 secure-store（Android 走系统 Keystore 密文，浏览器退回 localStorage）。
 * 只保存在本机，不会上传；用户取消勾选时立即删除。
 */
import { secureGet, secureRemove, secureSet } from './secure-store';

const USER_KEY = 'itdc_school_user_';
const PASS_KEY = 'itdc_school_pass_';
const REMEMBER_KEY = 'itdc_school_remember';

export interface SchoolCreds {
  username: string;
  password: string;
}

/** 是否默认记住（默认开：用户装了这个功能就是不想每次都输） */
export function getRememberEnabled(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setRememberEnabled(on: boolean): void {
  try { localStorage.setItem(REMEMBER_KEY, String(on)); } catch { /* 忽略存储失败 */ }
}

export async function saveSchoolCreds(schoolId: string, username: string, password: string): Promise<void> {
  try {
    localStorage.setItem(USER_KEY + schoolId, username);
  } catch { /* 忽略存储失败 */ }
  await secureSet(PASS_KEY + schoolId, password);
}

export async function loadSchoolCreds(schoolId: string): Promise<SchoolCreds | null> {
  let username = '';
  try {
    username = localStorage.getItem(USER_KEY + schoolId) ?? '';
  } catch { /* 忽略读取失败 */ }
  if (!username) return null;
  const password = (await secureGet(PASS_KEY + schoolId)) ?? '';
  if (!password) return null;
  return { username, password };
}

export async function clearSchoolCreds(schoolId: string): Promise<void> {
  try { localStorage.removeItem(USER_KEY + schoolId); } catch { /* 忽略 */ }
  await secureRemove(PASS_KEY + schoolId);
}
