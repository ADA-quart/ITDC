// PP-OCRv4（PaddleOCR / RapidOCR 的 ONNX 版）浏览器推理实现。
//
// 流程：det（DBNet 检测文字区域）→ 版面合并成「行」→ rec（CRNN 逐行识别）
//       → CTC 贪心解码 → 按视觉顺序拼成多行文本。
//
// 与官方后处理的差异（有意为之，代码量差一个数量级）：
//   官方用「二值图找轮廓 → 最小外接旋转矩形 → unclip 扩张」，得自己实现轮廓、
//   旋转卡壳和裁剪；这里改成「连通域 + 按垂直重叠/水平间距合并成行」的轴对齐
//   文本框，再按行高比例外扩替代 unclip（见 EXPAND_X/Y）。对手机截图
//   （通知、作业清单、课表）完全够用，且天然给出阅读顺序；
//   代价是不支持倾斜/竖排文本——这两类本来也不是「截图转待办」的场景。
// 注意：这里刻意用 alias 指向 "extern wasm" 变体（见 vite.config.ts），
// 它只带 JS 胶水、把 13.6MB 的 wasm 留给运行时提供；默认入口会把 wasm
// 打进包（webgpu 那份 28MB），给所有用户白加体积。
import * as ort from 'onnxruntime-web/wasm';
import dictRaw from '../../assets/ppocr_keys_v1.txt?raw';
import { loadOcrFile } from './installer';

// det 输入长边上限。PaddleOCR 默认 960 是给"整页文档扫描"用的；手机截图里
// 一行字在 960 长边下只剩 8~10 像素高，det 框裁掉 1~2 像素就会把字顶切掉、
// rec 整行变乱码（实测同一行文字有的卡片认得、有的认不出就是这个原因）。
// 提到 1536 后单行回到 ~30 像素，代价是 det 耗时约 2.5 倍（桌面 ~0.5s→~1.2s）。
const DET_LIMIT = 1536;
/** det 输出二值化阈值 */
const BIN_THRESHOLD = 0.3;
/** 整行平均置信度低于此值就丢掉，避免把噪声当文字 */
const BOX_SCORE_MIN = 0.5;
/** rec 识别置信度下限 */
const REC_SCORE_MIN = 0.4;
const REC_HEIGHT = 48;
const REC_MAX_WIDTH = 320;

// DBNet 输出的概率图是「收缩后的文本核」，不是完整字形框：实测同一行
// 大标题（~21px 高）的核高只有文字真高的 ~50%，上下各丢半个字；小字丢得少些。
// 官方后处理用轮廓 unclip 扩张，这里按「核高」的比例外扩回去（按比例而不是
// 按绝对像素，因为 det 输入尺寸会随图片缩放）。外扩只是多带一点白边，
// 不影响 rec；不扩则会裁掉笔画导致整行识别成乱码。
const EXPAND_Y = 0.55;
const EXPAND_X = 0.4;

const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];

const DICT: string[] = dictRaw.split(/\r?\n/);

let detSession: ort.InferenceSession | null = null;
let recSession: ort.InferenceSession | null = null;
let loading: Promise<void> | null = null;

/** 会话常驻内存（首次约 1-2s），卸载扩展后由 resetOcrEngine 释放 */
export async function ensureOcrEngine(): Promise<void> {
  if (detSession && recSession) return;
  if (loading) return loading;
  loading = (async () => {
    const det = await loadOcrFile('itdc_ocr_det');
    const rec = await loadOcrFile('itdc_ocr_rec');
    if (!det || !rec) throw new Error('OCR 扩展未安装完整');

    ort.env.wasm.numThreads = 1; // 线程版需要 COOP/COEP 的 SharedArrayBuffer，WebView 里拿不到
    ort.env.wasm.simd = true;
    // wasm 由打包器随 APK 分发，ONNX Runtime 按胶水文件的位置自动找到它

    const options: ort.InferenceSession.SessionOptions = {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    };
    detSession = await ort.InferenceSession.create(det, options);
    recSession = await ort.InferenceSession.create(rec, options);
  })();
  try {
    await loading;
  } finally {
    loading = null;
  }
}

export function resetOcrEngine(): void {
  detSession = null;
  recSession = null;
  loading = null;
}

interface TextBox {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

/**
 * dataURL → ImageData。裁剪图直接取自这里的画布，所以这里每多压一档，
 * rec 拿到的小字就模糊一档：手机截图（长边 ~2700）在 1600 下小字被压掉一半
 * 笔画，实测灰度小字（"已截止 2026-09-25 12:00"）会整行认不出来。
 * 上限放到 3000 后截图基本原分辨率进裁剪；普通照片仍然会被压到 3000 以内。
 */
async function loadImageData(dataUrl: string): Promise<{ data: ImageData }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('图片解码失败'));
    el.src = dataUrl;
  });
  const maxSide = 3000;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 不可用');
  ctx.drawImage(img, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h) };
}

/** 检测输入：长边 ≤DET_LIMIT 且两边都是 32 的倍数，ImageNet 归一化，NCHW */
function buildDetInput(src: ImageData): { tensor: ort.Tensor } {
  const limit = DET_LIMIT;
  const ratio = Math.min(1, limit / Math.max(src.width, src.height));
  let w = Math.max(32, Math.round((src.width * ratio) / 32) * 32);
  let h = Math.max(32, Math.round((src.height * ratio) / 32) * 32);
  if (w > limit) w = limit;
  if (h > limit) h = limit;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 不可用');
  ctx.drawImage(toCanvas(src), 0, 0, w, h);
  const resized = ctx.getImageData(0, 0, w, h).data;

  const out = new Float32Array(3 * w * h);
  const area = w * h;
  for (let i = 0; i < area; i += 1) {
    const r = resized[i * 4] / 255;
    const g = resized[i * 4 + 1] / 255;
    const b = resized[i * 4 + 2] / 255;
    out[i] = (r - DET_MEAN[0]) / DET_STD[0];
    out[area + i] = (g - DET_MEAN[1]) / DET_STD[1];
    out[area * 2 + i] = (b - DET_MEAN[2]) / DET_STD[2];
  }
  return { tensor: new ort.Tensor('float32', out, [1, 3, h, w]) };
}

function toCanvas(src: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = src.width;
  canvas.height = src.height;
  canvas.getContext('2d')?.putImageData(src, 0, 0);
  return canvas;
}

/**
 * det 输出（1x1xHxW 概率图）→ 文本框列表。
 *
 * 先二值化，再 8 邻域连通域（中文字间距小，单个字可能各自成块），
 * 然后按「垂直重叠 > 50% 且水平间距 < 0.8 倍行高」合并成整行。
 */
function detectBoxes(prob: Float32Array, w: number, h: number): TextBox[] {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i += 1) mask[i] = prob[i] > BIN_THRESHOLD ? 1 : 0;

  const seen = new Uint8Array(w * h);
  const comps: TextBox[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    let minX = w;
    let maxX = -1;
    let minY = h;
    let maxY = -1;
    let sum = 0;
    let count = 0;
    while (stack.length) {
      const idx = stack.pop() as number;
      const x = idx % w;
      const y = (idx - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      sum += prob[idx];
      count += 1;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nIdx = ny * w + nx;
          if (mask[nIdx] && !seen[nIdx]) {
            seen[nIdx] = 1;
            stack.push(nIdx);
          }
        }
      }
    }
    if (count < 4) continue; // 噪点
    comps.push({
      x: minX,
      y: minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
      score: sum / count,
    });
  }
  comps.sort((a, b) => a.y - b.y || a.x - b.x);

  const lines: TextBox[] = [];
  for (const comp of comps) {
    const row = lines.find((line) => {
      const overlap =
        Math.min(line.y + line.h, comp.y + comp.h) - Math.max(line.y, comp.y);
      if (overlap <= 0) return false;
      const ratio = overlap / Math.min(line.h, comp.h);
      const gap = comp.x - (line.x + line.w);
      const lineHeight = Math.max(line.h, comp.h);
      // 同一行的字块之间可能有负间距（重叠）或小空隙，超过大半个字高就算换行
      return ratio > 0.5 && gap < lineHeight * 0.8;
    });
    if (row) {
      const x1 = Math.min(row.x, comp.x);
      const y1 = Math.min(row.y, comp.y);
      const x2 = Math.max(row.x + row.w, comp.x + comp.w);
      const y2 = Math.max(row.y + row.h, comp.y + comp.h);
      const weight = row.w * row.h + comp.w * comp.h;
      row.score = (row.score * (weight - comp.w * comp.h) + comp.score * (comp.w * comp.h)) / weight;
      row.x = x1;
      row.y = y1;
      row.w = x2 - x1;
      row.h = y2 - y1;
    } else {
      lines.push({ ...comp });
    }
  }
  const kept = lines.filter((line) => line.score >= BOX_SCORE_MIN && line.h >= 6);
  // 还原被 DBNet 收缩掉的字形边缘（见 EXPAND_* 注释），裁剪前重新钳到图内
  return kept.map((line) => {
    const padX = Math.max(1, Math.round(line.h * EXPAND_X));
    const padY = Math.max(1, Math.round(line.h * EXPAND_Y));
    const x1 = Math.max(0, line.x - padX);
    const y1 = Math.max(0, line.y - padY);
    const x2 = Math.min(w, line.x + line.w + padX);
    const y2 = Math.min(h, line.y + line.h + padY);
    return { ...line, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  });
}

/** 按视觉顺序排序：先按行（垂直中心聚簇），行内从左到右 */
function sortReadingOrder(boxes: TextBox[]): TextBox[] {
  const sorted = [...boxes].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const rows: TextBox[][] = [];
  for (const box of sorted) {
    const center = box.y + box.h / 2;
    const row = rows.find((r) => {
      const ref = r[0];
      const refCenter = ref.y + ref.h / 2;
      return Math.abs(refCenter - center) < Math.max(ref.h, box.h) * 0.6;
    });
    if (row) row.push(box);
    else rows.push([box]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

/** 单行裁剪 → rec 输入（高 48，等比缩放，[-1,1] 归一化） */
function buildRecInput(
  srcCanvas: HTMLCanvasElement,
  box: TextBox,
  scaleX: number,
  scaleY: number,
  withCropPreview = false,
): { tensor: ort.Tensor; w: number; cropDataUrl?: string } {
  const pad = 2;
  const sx = Math.max(0, Math.floor(box.x * scaleX) - pad);
  const sy = Math.max(0, Math.floor(box.y * scaleY) - pad);
  const sw = Math.min(srcCanvas.width - sx, Math.ceil(box.w * scaleX) + pad * 2);
  const sh = Math.min(srcCanvas.height - sy, Math.ceil(box.h * scaleY) + pad * 2);
  const ratio = REC_HEIGHT / Math.max(1, sh);
  const w = Math.max(8, Math.min(REC_MAX_WIDTH, Math.round(sw * ratio)));

  let cropDataUrl: string | undefined;
  if (withCropPreview) {
    const preview = document.createElement('canvas');
    preview.width = Math.max(1, sw);
    preview.height = Math.max(1, sh);
    const pctx = preview.getContext('2d');
    if (pctx) {
      pctx.drawImage(srcCanvas, sx, sy, Math.max(1, sw), Math.max(1, sh), 0, 0, preview.width, preview.height);
      cropDataUrl = preview.toDataURL('image/jpeg', 0.7);
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = REC_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 不可用');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(srcCanvas, sx, sy, Math.max(1, sw), Math.max(1, sh), 0, 0, w, REC_HEIGHT);
  const data = ctx.getImageData(0, 0, w, REC_HEIGHT).data;

  const area = w * REC_HEIGHT;
  const out = new Float32Array(3 * area);
  for (let i = 0; i < area; i += 1) {
    out[i] = data[i * 4] / 255 / 0.5 - 1;
    out[area + i] = data[i * 4 + 1] / 255 / 0.5 - 1;
    out[area * 2 + i] = data[i * 4 + 2] / 255 / 0.5 - 1;
  }
  return { tensor: new ort.Tensor('float32', out, [1, 3, REC_HEIGHT, w]), w, cropDataUrl };
}

/** CTC 贪心解码：0 是 blank，1..N 是字典（末位是空格） */
function decodeCtc(logits: Float32Array, steps: number, classes: number): { text: string; score: number } {
  let text = '';
  let scoreSum = 0;
  let kept = 0;
  let prev = -1;
  for (let t = 0; t < steps; t += 1) {
    let best = 0;
    let bestVal = logits[t * classes];
    for (let c = 1; c < classes; c += 1) {
      const v = logits[t * classes + c];
      if (v > bestVal) {
        bestVal = v;
        best = c;
      }
    }
    if (best === prev) continue;
    prev = best;
    if (best === 0) continue;
    const ch = best - 1 < DICT.length ? DICT[best - 1] : ' ';
    text += ch ?? '';
    scoreSum += bestVal;
    kept += 1;
  }
  return { text, score: kept ? scoreSum / kept : 0 };
}

export interface OcrLineDetail {
  text: string;
  /** rec 平均字符置信度 */
  score: number;
  /** det 出的框（det 输入坐标系） */
  box: TextBox;
  /** 被阈值丢弃的原因（未丢则为空） */
  droppedBy?: 'box-score' | 'rec-score' | 'empty';
  /** 调试用：实际喂给 rec 的裁剪图（dataURL，仅 recognizeImageDetailed(…, true) 时返回） */
  cropDataUrl?: string;
}

export interface OcrDetail {
  text: string;
  lines: OcrLineDetail[];
  /** det 合并后的行框数量（含后续被丢弃的） */
  boxCount: number;
  /** 各阶段耗时，排查"为什么这么慢"用 */
  timing: { detectMs: number; recognizeMs: number; totalMs: number };
}

/**
 * 主入口：图片 dataURL → 多行文本。
 * 详细版（recognizeImageDetailed）额外返回每个框的识别结果与置信度，
 * 排查"某一行为什么没了"时用：是在 det 没框出来、box 置信度被丢，
 * 还是 rec 认成了空串 / 低置信度。
 */
export async function recognizeImageDetailed(dataUrl: string, withCrops = false): Promise<OcrDetail> {
  const t0 = performance.now();
  await ensureOcrEngine();
  if (!detSession || !recSession) throw new Error('OCR 引擎未就绪');

  const { data } = await loadImageData(dataUrl);
  const srcCanvas = toCanvas(data);
  const detInput = buildDetInput(data);
  const tDet = performance.now();
  const detOut = await detSession.run({ [detSession.inputNames[0]]: detInput.tensor });
  const detTensor = detOut[detSession.outputNames[0]];
  const dims = detTensor.dims as number[];
  const outH = dims[dims.length - 2];
  const outW = dims[dims.length - 1];
  const prob = detTensor.data as Float32Array;
  const detectMs = performance.now() - tDet;

  const boxes = sortReadingOrder(detectBoxes(prob, outW, outH));
  // det 输出像素 → 原图坐标。必须分横纵两个比例：det 输入被 32 对齐后
  // 横纵比和原图有 ~2% 差异，只用一个比例时误差随 y 放大——页面底部的行
  // 会被整体上移半个字高，裁剪切掉字顶，rec 出来就是"第一共调后作业"这种乱码。
  const scaleX = data.width / outW;
  const scaleY = data.height / outH;
  const tRec = performance.now();
  const details: OcrLineDetail[] = [];
  for (const box of boxes) {
    const recInput = buildRecInput(srcCanvas, box, scaleX, scaleY, withCrops);
    const recOut = await recSession.run({ [recSession.inputNames[0]]: recInput.tensor });
    const recTensor = recOut[recSession.outputNames[0]];
    const rd = recTensor.dims as number[];
    const classes = rd[rd.length - 1];
    const steps = rd[rd.length - 2];
    const { text, score } = decodeCtc(recTensor.data as Float32Array, steps, classes);
    const clean = text.trim();
    const droppedBy = !clean ? 'empty' : score < REC_SCORE_MIN ? 'rec-score' : undefined;
    details.push({ text: clean, score, box, droppedBy, cropDataUrl: recInput.cropDataUrl });
  }
  const recognizeMs = performance.now() - tRec;
  const kept = details.filter((d) => !d.droppedBy);
  return {
    text: kept.map((d) => d.text).join('\n'),
    lines: details,
    boxCount: boxes.length,
    timing: { detectMs, recognizeMs, totalMs: performance.now() - t0 },
  };
}

/** 主入口（简版）：图片 dataURL → 多行文本 */
export async function recognizeImage(dataUrl: string): Promise<string> {
  return (await recognizeImageDetailed(dataUrl)).text;
}
