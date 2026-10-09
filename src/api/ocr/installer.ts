// 离线 OCR 扩展：模型与运行时按需下载，存 IndexedDB，卸载即清空。
//
// 为什么下载而不是打包进 APK：onnxruntime 的 wasm 13.6MB + 两个模型 15.6MB，
// 直接塞进包里会给不用 OCR 的用户白加 30MB。下载后完全离线可用。
//
// 三个文件都做了「多镜像 + 体积校验 + 头字节校验」，避免下到半截的包或错误页
// 被当成模型存下来（存坏了会在推理时才炸，排查很痛苦）。
import { kvGet, kvSet } from '../offline';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

export interface OcrFileSpec {
  /** IndexedDB 的键 */
  key: string;
  /** 展示用文件名 */
  name: string;
  /** 期望字节数（校验用） */
  bytes: number;
  /** 依次尝试的镜像地址（第一个是国内可直连的） */
  urls: string[];
  /** 文件头校验：前 4 字节 */
  magic: number[];
}

const HF_MIRROR = 'https://hf-mirror.com/SWHL/RapidOCR/resolve/main/PP-OCRv4';
const HF = 'https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4';

// 模型：PP-OCRv4 mobile（PaddleOCR / RapidOCR，Apache-2.0）。主源 hf-mirror、
// 兜底 huggingface，两者都带 CORS，WebView 的 fetch 与原生下载都能取。
//
// 关于 int8（试过，结论：对本模型不可用）：仓库的 ocr-models 分支 / ocr-models-v1
// Release 里托管了 onnxruntime 动态量化版，实测——
//   * det int8 正常出框，但同一张图整条流水线从 2.1s 变 4.9s（WASM 上 ConvInteger 比 fp32 慢）；
//   * rec int8 直接输出空字符串，只量化卷积主干（保留 MatMul 头）也一样空；
//     det32+rec8 / det8+rec8 均为空、det8+rec32 正常 → 破的是识别模型本身。
// 所以仍用 fp32；要做小得换静态量化（QDQ + 校准集）或 fp16，并重新实测精度。
//
// 运行时（onnxruntime-web 的 JS + 14.2MB wasm）随 APK 分发：wasm 会被打包器当成
// 资源引用带走，与其让所有人额外下载 14.2MB，不如跟包走一次（zip 里约 4MB）。
export const OCR_FILES: OcrFileSpec[] = [
  {
    key: 'itdc_ocr_det',
    name: 'ch_PP-OCRv4_det_infer.onnx（文字检测 4.5MB）',
    bytes: 4745517,
    urls: [
      `${HF_MIRROR}/ch_PP-OCRv4_det_infer.onnx`,
      `${HF}/ch_PP-OCRv4_det_infer.onnx`,
    ],
    magic: [],
  },
  {
    key: 'itdc_ocr_rec',
    name: 'ch_PP-OCRv4_rec_infer.onnx（文字识别 10.3MB）',
    bytes: 10857958,
    urls: [
      `${HF_MIRROR}/ch_PP-OCRv4_rec_infer.onnx`,
      `${HF}/ch_PP-OCRv4_rec_infer.onnx`,
    ],
    magic: [],
  },
];

export const OCR_TOTAL_BYTES = OCR_FILES.reduce((sum, f) => sum + f.bytes, 0);

export interface OcrProgress {
  fileName: string;
  fileIndex: number;
  fileCount: number;
  loaded: number;
  total: number;
  /** 全部文件的总进度 0-100 */
  percent: number;
}

export interface OcrStatus {
  installed: boolean;
  /** 已安装文件数（部分安装时为 0 < n < 3，UI 上按未安装处理） */
  present: number;
  bytes: number;
}

/** 校验：体积一致 + 头字节匹配（wasm 需要，onnx 是 protobuf 无固定头） */
function looksValid(spec: OcrFileSpec, buf: ArrayBuffer): boolean {
  if (buf.byteLength !== spec.bytes) return false;
  if (spec.magic.length) {
    const head = new Uint8Array(buf, 0, spec.magic.length);
    for (let i = 0; i < spec.magic.length; i += 1) {
      if (head[i] !== spec.magic[i]) return false;
    }
  }
  return true;
}

export async function ocrStatus(): Promise<OcrStatus> {
  let present = 0;
  let bytes = 0;
  for (const spec of OCR_FILES) {
    const buf = await kvGet<ArrayBuffer>(spec.key);
    if (buf && looksValid(spec, buf)) {
      present += 1;
      bytes += buf.byteLength;
    }
  }
  return { installed: present === OCR_FILES.length, present, bytes };
}

export async function loadOcrFile(key: string): Promise<ArrayBuffer | undefined> {
  return kvGet<ArrayBuffer>(key);
}

/** 逐个文件、逐个镜像地下载；任一文件成功后立刻落盘，中断后下次可续着装 */
export async function installOcr(
  onProgress: (p: OcrProgress) => void,
  shouldAbort?: () => boolean,
): Promise<void> {
  let finishedBytes = 0;

  for (let i = 0; i < OCR_FILES.length; i += 1) {
    const spec = OCR_FILES[i];
    const existing = await kvGet<ArrayBuffer>(spec.key);
    if (existing && looksValid(spec, existing)) {
      finishedBytes += spec.bytes;
      continue;
    }
    let buf: ArrayBuffer | null = null;
    let lastError = '';
    for (const url of spec.urls) {
      try {
        buf = await downloadWithProgress(url, spec, i, finishedBytes, onProgress, shouldAbort);
        if (buf && looksValid(spec, buf)) break;
        buf = null;
        lastError = '文件校验未通过';
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        buf = null;
      }
      if (shouldAbort?.()) throw new Error('已取消');
    }
    if (!buf) throw new Error(`${spec.name} 下载失败：${lastError || '所有镜像均不可用'}`);
    await kvSet(spec.key, buf);
    finishedBytes += spec.bytes;
  }
}

async function downloadWithProgress(
  url: string,
  spec: OcrFileSpec,
  fileIndex: number,
  finishedBytes: number,
  onProgress: (p: OcrProgress) => void,
  shouldAbort?: () => boolean,
): Promise<ArrayBuffer> {
  // 原生端走 Filesystem.downloadFile：GitHub Release 的下载地址是 302 到
  // objects.githubusercontent.com，那一跳没有 CORS 头，WebView 里 fetch 必然
  // 报 "Failed to fetch"；原生 HTTP 不受同源策略限制。代价是没有字节级进度，
  // 按「每个文件完成」推进进度条。
  if (Capacitor.isNativePlatform()) {
    const name = `ocr-dl-${fileIndex}-${Date.now()}.bin`;
    onProgress({
      fileName: spec.name,
      fileIndex,
      fileCount: OCR_FILES.length,
      loaded: 0,
      total: spec.bytes,
      percent: Math.round((finishedBytes / OCR_TOTAL_BYTES) * 100),
    });
    try {
      await Filesystem.downloadFile({ url, path: name, directory: Directory.Cache });
      const file = await Filesystem.readFile({ path: name, directory: Directory.Cache });
      const b64 = typeof file.data === 'string' ? file.data : '';
      if (!b64) throw new Error('下载内容为空');
      const raw = atob(b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
      return bytes.buffer;
    } finally {
      if (shouldAbort?.()) throw new Error('已取消');
      try {
        await Filesystem.deleteFile({ path: name, directory: Directory.Cache });
      } catch {
        /* 缓存目录，删不掉也不影响 */
      }
    }
  }

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get('content-length') || 0);
  const total = declared > 0 ? declared : spec.bytes;
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = await res.arrayBuffer();
    onProgress({
      fileName: spec.name,
      fileIndex,
      fileCount: OCR_FILES.length,
      loaded: buf.byteLength,
      total: buf.byteLength,
      percent: Math.round(((finishedBytes + buf.byteLength) / OCR_TOTAL_BYTES) * 100),
    });
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    if (shouldAbort?.()) {
      void reader.cancel();
      throw new Error('已取消');
    }
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress({
        fileName: spec.name,
        fileIndex,
        fileCount: OCR_FILES.length,
        loaded,
        total,
        percent: Math.min(99, Math.round(((finishedBytes + loaded) / OCR_TOTAL_BYTES) * 100)),
      });
    }
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

export async function removeOcr(): Promise<void> {
  for (const spec of OCR_FILES) {
    await kvSet(spec.key, null);
  }
}

/** 人类可读体积，UI 上显示 29.0MB 这种 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}
