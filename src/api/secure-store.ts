// 本机密钥读写。
//
// Android：交给原生 Keystore（AES-GCM，密钥不可导出），密文存应用私有目录。
// 浏览器：没有等价设施，只能放 localStorage —— 设置页会明确提示这一点，
// 不假装它是加密的。
import { Capacitor } from '@capacitor/core';
import { ITDCWidgetPlugin } from '../capacitor/itdc-widget';

const WEB_PREFIX = 'itdc_secure_';

/** 当前平台是否有系统级密钥保护（用于设置页文案） */
export function hasSystemKeystore(): boolean {
  return Capacitor.isNativePlatform();
}

export async function secureSet(name: string, value: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await ITDCWidgetPlugin.secureSet({ key: name, value });
    return;
  }
  try {
    localStorage.setItem(WEB_PREFIX + name, value);
  } catch {
    // 配额满或隐私模式：本次会话仍可用，只是重启后要重填
  }
}

export async function secureGet(name: string): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const res = await ITDCWidgetPlugin.secureGet({ key: name });
      return res?.value ?? null;
    } catch {
      return null;
    }
  }
  try {
    return localStorage.getItem(WEB_PREFIX + name);
  } catch {
    return null;
  }
}

export async function secureRemove(name: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await ITDCWidgetPlugin.secureRemove({ key: name });
    } catch {
      // 删除失败不影响上层：记录本身已经被移除
    }
    return;
  }
  try {
    localStorage.removeItem(WEB_PREFIX + name);
  } catch {
    // 忽略
  }
}
