// 本地 OCR（可选扩展）：模型按需下载，下载前不可用。
//
// 这是图片待办「降级链」的中间环节：图片直发失败（模型不支持视觉 /
// 没网）时，若本地 OCR 可用则改走「OCR 出文字 → 文本 AI 提取 →
// 仍失败则降级存原文」。
//
// 引擎为 PP-OCRv4（PaddleOCR / RapidOCR 的 ONNX 版）跑在 onnxruntime-web 上：
// 检测与识别都在本机完成，全程离线、不需要 GMS；模型与 wasm 由用户按需下载，
// 见 ocr/installer.ts。
import { installOcr, ocrStatus, removeOcr } from './ocr/installer';
import { ensureOcrEngine, recognizeImage, resetOcrEngine } from './ocr/ppocr';

/** 同步可读的就绪标记：TodoList 是在点击瞬间同步判断的 */
let available = false;
let prewarmed = false;

export function isLocalOcrAvailable(): boolean {
  return available;
}

/** App 启动 / 扩展页操作后刷新状态（读 IndexedDB 很快，但仍然异步） */
export async function refreshLocalOcrState(): Promise<boolean> {
  const status = await ocrStatus();
  available = status.installed;
  if (!available) {
    resetOcrEngine();
  } else {
    prewarmLocalOcr();
  }
  return available;
}

/**
 * 后台预热：提前把两个 ONNX 会话建好，免得用户第一次真用 OCR 时
 * 还要等模型读盘 + 建图（实测冷启动 10s、热识别 3.4s）。
 * 只在扩展已安装时做，空闲时触发，失败静默。
 */
export function prewarmLocalOcr(): void {
  if (prewarmed || !available) return;
  prewarmed = true;
  const start = () => {
    void ensureOcrEngine().catch(() => {
      prewarmed = false;
    });
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(start, { timeout: 4000 });
  } else {
    setTimeout(start, 1500);
  }
}

export async function recognizeTextLocally(dataUrl: string): Promise<string> {
  if (!available) throw new Error('本地 OCR 扩展尚未安装');
  return recognizeImage(dataUrl);
}

export async function uninstallLocalOcr(): Promise<void> {
  available = false;
  resetOcrEngine();
  await removeOcr();
}

export { installOcr, ocrStatus, formatBytes, OCR_TOTAL_BYTES } from './ocr/installer';
export type { OcrProgress, OcrStatus } from './ocr/installer';

/**
 * 诊断入口：把 `localStorage.itdc_debug` 设成 '1' 并重载后，控制台可用
 * `__itdcOcr.recognizeImage(dataUrl)` 直接跑一遍识别（跳过"是否已安装"的判断），
 * 排查模型/算子问题用。平时不暴露。
 */
if (typeof window !== 'undefined' && window.localStorage?.getItem('itdc_debug') === '1') {
  (window as unknown as Record<string, unknown>).__itdcOcr = {
    recognizeImage,
    recognizeTextLocally,
    refreshLocalOcrState,
    prewarmLocalOcr,
    ocrStatus,
    installOcr,
    resetOcrEngine,
  };
}
