import { registerPlugin } from "@capacitor/core";

export interface ItdcWidgetPluginInterface {
  setServerUrl(params: { url: string }): Promise<void>;
  /** 把今日数据快照交给原生侧，供桌面小组件在本机模式下渲染 */
  pushSnapshot(params: { json: string; mode: 'local' | 'server' }): Promise<void>;
}

export const ITDCWidgetPlugin = registerPlugin<ItdcWidgetPluginInterface>("itdc-widget");