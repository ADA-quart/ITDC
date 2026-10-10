// 外观个性化：主题色、应用背景图、桌面小组件配色与背景图。
//
// 存储策略：背景图（base64 data URL，几百 KB）放 IndexedDB，
// 其余配置很小，放 localStorage 以便启动时同步读取。
import { Capacitor } from '@capacitor/core';
import { ITDCWidgetPlugin } from '../capacitor/itdc-widget';
import { kvGet, kvSet } from './offline';

/** 小组件明暗：auto 跟随系统，light/dark 由用户指定 */
export type WidgetScheme = 'auto' | 'light' | 'dark';

/**
 * 背景图缩放范围：1 倍 = cover 铺满（头像式裁切基准），
 * 大于 1 放大取局部，小于 1 是缩小（四周由同图模糊放大版打底，不会露白）。
 */
export const MIN_BG_ZOOM = 0.5;
export const MAX_BG_ZOOM = 3;

export interface AppearanceSettings {
  /** 应用主题色：#RRGGBB */
  accent: string;
  /** 应用背景图（base64 data URL），null 表示纯色背景 */
  bgImage: string | null;
  /** 背景图不透明度 0-100 */
  bgOpacity: number;
  /** 背景图高斯模糊 0-20 px */
  bgBlur: number;
  /** 背景图焦点（0-100，50 为居中）：cover 时决定保留哪一边 */
  bgFocusX: number;
  bgFocusY: number;
  /** 图片缩放（0.5-3 倍；1 倍为 cover 铺满，>1 放大取局部，<1 缩小并露出模糊打底） */
  bgZoom: number;
  /** 有背景图时，日历/卡片等界面的透明度 0-100（0 纯透明，100 不透明） */
  uiOpacity: number;
  /** 有背景图时，界面的背景模糊 0-20 px（0 = 纯透明不磨砂） */
  uiBlur: number;
  /** 小组件主题色是否跟随应用主题色 */
  widgetFollowAccent: boolean;
  /** 小组件单独的主题色（widgetFollowAccent=false 时生效） */
  widgetAccent: string;
  /** 小组件面板底色，null 表示按明暗自动（浅色白 / 深色黑） */
  widgetPanelColor: string | null;
  /** 小组件面板不透明度 0-100 */
  widgetPanelOpacity: number;
  /** 小组件明暗 */
  widgetScheme: WidgetScheme;
  /** 小组件是否使用应用背景图 */
  widgetUseBgImage: boolean;
}

/** 预设主题色：与小组件默认色一致，避免两处各写一份 */
/**
 * 主题色预设：常用品牌色 + 几个大家认识的角色色（带名字，鼠标悬停/读屏可见）。
 *
 * 角色色的取值来源：
 *   - 洛天依蓝 #66CCFF：官方/维基百科、萌娘百科「天依蓝」条目一致的应援色；
 *   - 初音未来绿 #39C5BB：官方苍绿色（VCPedia / 萌娘百科 / 番组百科 rgb(57,197,187)）；
 *   - 永雏塔菲粉 #FD779E：官方设定只写「粉发」、无公开色号，取社区共识里的
 *     品牌粉主色调（主题插件标注为品牌粉；萌百标语色 #F95378 偏艳，背景色
 *     #fcd2d2/#ffd7e4 太淡，都不适合当强调色）；
 *   - 奶龙黄 #FFD700：官方只有「体色（奶）黄色」的描述、没公开色号，取社区/教程里
 *     最常用的标志性金黄（Turtle 画奶龙、数字绘画都用它）。纯金底 + 白字对比度偏低，
 *     在意可读性的话选别的预设即可。
 */
export const ACCENT_PRESETS: { hex: string; name: string }[] = [
  { hex: '#4C9AFF', name: '天蓝' },
  { hex: '#1677FF', name: '拂晓蓝' },
  { hex: '#722ED1', name: '酱紫' },
  { hex: '#EB2F96', name: '洋红' },
  { hex: '#F5222D', name: '薄暮红' },
  { hex: '#FA8C16', name: '日暮橙' },
  { hex: '#52C41A', name: '极光绿' },
  { hex: '#13C2C2', name: '明青' },
  { hex: '#66CCFF', name: '洛天依蓝' },
  { hex: '#39C5BB', name: '初音未来绿' },
  { hex: '#FD779E', name: '永雏塔菲粉' },
  { hex: '#FFD700', name: '奶龙黄' },
];

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  accent: '#1677FF',
  bgImage: null,
  bgOpacity: 100,
  bgBlur: 0,
  bgFocusX: 50,
  bgFocusY: 50,
  bgZoom: 1,
  uiOpacity: 62,
  uiBlur: 14,
  widgetFollowAccent: true,
  widgetAccent: '#4C9AFF',
  widgetPanelColor: null,
  widgetPanelOpacity: 90,
  widgetScheme: 'auto',
  widgetUseBgImage: false,
};

const LS_KEY = 'itdc_appearance';
const IMG_KEY = 'itdc_bg_image';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function hex(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_RE.test(value) ? value.toUpperCase() : fallback;
}

/** 归一化外部数据（localStorage 可能被旧版本或手动改坏），任何字段异常都退回默认值 */
export function sanitizeAppearance(raw: unknown): AppearanceSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppearanceSettings>;
  const scheme: WidgetScheme =
    o.widgetScheme === 'light' || o.widgetScheme === 'dark' || o.widgetScheme === 'auto'
      ? o.widgetScheme
      : DEFAULT_APPEARANCE.widgetScheme;

  return {
    accent: hex(o.accent, DEFAULT_APPEARANCE.accent),
    // 背景图不放 localStorage，只从 IndexedDB 单独恢复
    bgImage: typeof o.bgImage === 'string' && o.bgImage.startsWith('data:image/') ? o.bgImage : null,
    bgOpacity: clamp(o.bgOpacity, 0, 100, DEFAULT_APPEARANCE.bgOpacity),
    bgBlur: clamp(o.bgBlur, 0, 20, DEFAULT_APPEARANCE.bgBlur),
    bgFocusX: clamp(o.bgFocusX, 0, 100, DEFAULT_APPEARANCE.bgFocusX),
    bgFocusY: clamp(o.bgFocusY, 0, 100, DEFAULT_APPEARANCE.bgFocusY),
    bgZoom: Math.max(
      MIN_BG_ZOOM,
      Math.min(MAX_BG_ZOOM, Number.isFinite(Number(o.bgZoom)) ? Number(o.bgZoom) : 1),
    ),
    uiOpacity: clamp(o.uiOpacity, 0, 100, DEFAULT_APPEARANCE.uiOpacity),
    uiBlur: clamp(o.uiBlur, 0, 20, DEFAULT_APPEARANCE.uiBlur),
    widgetFollowAccent: o.widgetFollowAccent !== false,
    widgetAccent: hex(o.widgetAccent, DEFAULT_APPEARANCE.widgetAccent),
    widgetPanelColor: typeof o.widgetPanelColor === 'string' && HEX_RE.test(o.widgetPanelColor)
      ? o.widgetPanelColor.toUpperCase()
      : null,
    widgetPanelOpacity: clamp(o.widgetPanelOpacity, 0, 100, DEFAULT_APPEARANCE.widgetPanelOpacity),
    widgetScheme: scheme,
    widgetUseBgImage: o.widgetUseBgImage === true,
  };
}

/** 同步读取配置（背景图字段为空，需再调用 loadBackgroundImage 补上） */
export function loadAppearance(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE };
    return { ...sanitizeAppearance(JSON.parse(raw)), bgImage: null };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export async function loadBackgroundImage(): Promise<string | null> {
  try {
    const value = await kvGet<string>(IMG_KEY);
    return typeof value === 'string' && value.startsWith('data:image/') ? value : null;
  } catch {
    return null;
  }
}

/** 写入 localStorage；背景图字段一律剥掉，它只走 IndexedDB */
export function saveAppearance(settings: AppearanceSettings): void {
  try {
    const { bgImage: _omit, ...rest } = settings;
    void _omit;
    localStorage.setItem(LS_KEY, JSON.stringify(rest));
  } catch {
    // 配额满或隐私模式：设置仅在本次会话生效，不阻塞使用
  }
}

export async function saveBackgroundImage(dataUrl: string | null): Promise<void> {
  try {
    await kvSet(IMG_KEY, dataUrl ?? null);
  } catch {
    // 存储失败时下次启动会丢图，但不影响当前会话预览
  }
}

export function resolveWidgetAccent(settings: AppearanceSettings): string {
  return settings.widgetFollowAccent ? settings.accent : settings.widgetAccent;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解析失败'));
    img.src = src;
  });
}

/**
 * 把用户选的图片压到适合做背景的尺寸再转 data URL。
 * 原图动辄几 MB，直接存会让 WebView 存储爆掉，也会拖慢与原生侧的传输。
 */
export async function compressImageToDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    let maxEdge = 1920;
    let quality = 0.82;
    let dataUrl = '';

    // 极少数图（噪声多、渐变复杂）压缩后仍偏大，逐级降级再试
    for (let attempt = 0; attempt < 3; attempt++) {
      const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('当前环境不支持画布');
      // JPEG 不支持透明通道，先铺白底，避免 PNG 透明区域变黑
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= 1_200_000) break;
      maxEdge = Math.round(maxEdge * 0.75);
      quality = Math.max(0.6, quality - 0.08);
    }

    if (!dataUrl.startsWith('data:image/')) throw new Error('图片转换失败');
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** 原生侧只认 base64 载荷本身，去掉 data URL 前缀再传 */
export function stripDataUrlPrefix(dataUrl: string): { mime: string; base64: string } {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('背景图格式不支持');
  return { mime: match[1], base64: match[2] };
}

// 上次真正传输过的图片：滑动条等外观微调不必重复传几百 KB 的图
let lastPushedImage: string | null = null;

/**
 * 把外观推给原生侧（仅 Android 生效）。
 * 传图有体积代价，因此只有首次或换图时才带 image 字段。
 */
export async function pushWidgetAppearance(settings: AppearanceSettings): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const wanted = settings.widgetUseBgImage ? settings.bgImage : null;
  const image = wanted && wanted !== lastPushedImage ? wanted : null;

  await ITDCWidgetPlugin.setAppearance({
    accent: resolveWidgetAccent(settings),
    panelColor: settings.widgetPanelColor ?? '',
    panelOpacity: settings.widgetPanelOpacity,
    scheme: settings.widgetScheme,
    hasImage: !!wanted,
    focusX: settings.bgFocusX,
    focusY: settings.bgFocusY,
    zoom: settings.bgZoom,
    ...(image ? { image } : {}),
  });

  lastPushedImage = wanted;
}

/** 退出「使用背景图」或删除图片时，原生侧需要把已存的文件一并清掉 */
export function resetPushedImageCache(): void {
  lastPushedImage = null;
}
