import { registerPlugin } from "@capacitor/core";

export interface ItdcWidgetPluginInterface {
  setServerUrl(params: { url: string }): Promise<void>;
  /** 用系统浏览器打开外部链接（发布页/项目主页） */
  openUrl(params: { url: string }): Promise<void>;
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
    /** 小组件固定边框内的焦点（0-100）与缩放（1-3 倍） */
    focusX: number;
    focusY: number;
    zoom: number;
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
  /** 本机密钥保险箱：Android 走 Keystore 加密，浏览器回退到 localStorage */
  secureSet(params: { key: string; value: string }): Promise<void>;
  secureGet(params: { key: string }): Promise<{ value?: string | null }>;
  secureRemove(params: { key: string }): Promise<void>;
  /**
   * 中文图片文字识别（ML Kit 本地模型，离线、不依赖 Google 服务）。
   * 前端把图片读成 data URL 传入，返回纯文本，交给「AI 添加」继续解析成待办。
   */
  recognizeText(params: { dataUrl: string }): Promise<{ text: string }>;
}

export const ITDCWidgetPlugin = registerPlugin<ItdcWidgetPluginInterface>("itdc-widget");
