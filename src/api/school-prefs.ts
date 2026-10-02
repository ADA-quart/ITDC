import * as offline from './offline';

/**
 * 学校选择偏好（本地 IndexedDB 存储，仅本机；跨设备跟随各设备自身设置）。
 */
const SCHOOL_KEY = 'school_id';

export async function getSelectedSchool(): Promise<string | null> {
  try {
    const v = await offline.kvGet<string>(SCHOOL_KEY);
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

export async function setSelectedSchool(schoolId: string | null): Promise<void> {
  if (schoolId) {
    await offline.kvSet(SCHOOL_KEY, schoolId);
  } else {
    await offline.kvSet(SCHOOL_KEY, '');
  }
}
