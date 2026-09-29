import { registerPlugin } from "@capacitor/core";

export interface ItdcWidgetPluginInterface {
  setServerUrl(params: { url: string }): Promise<void>;
  /** 把今日数据快照交给原生侧，供桌面小组件在本机模式下渲染 */
  pushSnapshot(params: { json: string; mode: 'local' | 'server' }): Promise<void>;
  /** 查询是否已排除电池优化（澎湃 OS / MIUI 会冻结后台导致小组件不刷新） */
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>;
  /** 打开系统电池优化设置页 */
  openBatterySettings(): Promise<void>;
}

export const ITDCWidgetPlugin = registerPlugin<ItdcWidgetPluginInterface>("itdc-widget");