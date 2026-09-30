import { registerPlugin } from "@capacitor/core";

export interface ItdcWidgetPluginInterface {
  setServerUrl(params: { url: string }): Promise<void>;
  /** 把今日数据快照交给原生侧，供桌面小组件在本机模式下渲染 */
  pushSnapshot(params: { json: string; mode: 'local' | 'server' }): Promise<void>;
  /**
   * 下发外观：主题色、面板底色/不透明度、明暗与背景图。
   * image 只在首次或换图时传（base64 data URL），平时省略以省掉重复传输。
   */
  setAppearance(params: {
    accent: string;
    panelColor: string;
    panelOpacity: number;
    scheme: 'auto' | 'light' | 'dark';
    hasImage: boolean;
    image?: string;
  }): Promise<void>;
  /** 查询是否已排除电池优化（澎湃 OS / MIUI 会冻结后台导致小组件不刷新） */
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>;
  /** 打开系统电池优化设置页 */
  openBatterySettings(): Promise<void>;
  /** 读取桌面上"打勾完成"的操作队列（待 App 写回数据库） */
  getDoneQueue(): Promise<{ done: number[]; undone: number[] }>;
  /** 写回成功后清空队列 */
  clearDoneQueue(): Promise<void>;
}

export const ITDCWidgetPlugin = registerPlugin<ItdcWidgetPluginInterface>("itdc-widget");
