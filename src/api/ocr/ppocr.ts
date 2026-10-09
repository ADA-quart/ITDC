// PP-OCRv4（PaddleOCR / RapidOCR 的 ONNX 版）浏览器推理实现。
//
// 流程：det（DBNet 检测文字区域）→ 版面合并成「行」→ rec（CRNN 逐行识别）
//       → CTC 贪心解码 → 按视觉顺序拼成多行文本。
//
// 与官方后处理的差异（有意为之，代码量差一个数量级）：
//   官方用「二值图找轮廓 → 最小外接旋转矩形 → unclip 扩张」，得自己实现轮廓、
//   旋转卡壳和裁剪；这里改成「连通域 + 按垂直重叠/水平间距合并成行」的轴对齐
//   文本框。对手机截图（通知、作业清单、课表）完全够用，且天然给出阅读顺序；
//   代价是不支持倾斜/竖排文本——这两类本来也不是「截图转待办」的场景。
// 注意：这里刻意用 alias 指向 "extern wasm" 变体（见 vite.config.ts），
// 它只带 JS 胶水、把 13.6MB 的 wasm 留给运行时提供；默认入口会把 wasm
// 打进包（webgpu 那份 28MB），给所有用户白加体积。
import * as ort from 'onnxruntime-web/wasm';
import dictRaw from '../../assets/ppocr_keys_v1.txt?raw';
import { loadOcrFile } from './installer';

/** det 输入长边上限，与 PaddleOCR 默认一致（必须是 32 的倍数） */
const DET_LIMIT = 960;
/** det 输出二值化阈值 */
const BIN_THRESHOLD = 0.3;
/** 整行平均置信度低于此值就丢掉，避免把噪声当文字 */
const BOX_SCORE_MIN = 0.5;
/** rec 识别置信度下限 */
const REC_SCORE_MIN = 0.4;
const REC_HEIGHT = 48;
const REC_MAX_WIDTH = 320;

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

/** dataURL → ImageData（超大图先等比缩到 1600 长边，省内存也够识别） */
async function loadImageData(dataUrl: string): Promise<{ data: ImageData; scale: number }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('图片解码失败'));
    el.src = dataUrl;
  });
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 不可用');
  ctx.drawImage(img, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h), scale };
}

/** 检测输入：长边 ≤960 且两边都是 32 的倍数，ImageNet 归一化，NCHW */
function buildDetInput(src: ImageData): { tensor: ort.Tensor; scale: number; w: number; h: number } {
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
  return {
    tensor: new ort.Tensor('float32', out, [1, 3, h, w]),
    scale: src.width / w,
    w,
    h,
  };
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
  return lines.filter((line) => line.score >= BOX_SCORE_MIN && line.h >= 6);
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
  scale: number,
): { tensor: ort.Tensor; w: number } {
  const pad = 2;
  const sx = Math.max(0, Math.floor(box.x * scale) - pad);
  const sy = Math.max(0, Math.floor(box.y * scale) - pad);
  const sw = Math.min(srcCanvas.width - sx, Math.ceil(box.w * scale) + pad * 2);
  const sh = Math.min(srcCanvas.height - sy, Math.ceil(box.h * scale) + pad * 2);
  const ratio = REC_HEIGHT / Math.max(1, sh);
  const w = Math.max(8, Math.min(REC_MAX_WIDTH, Math.round(sw * ratio)));

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
  return { tensor: new ort.Tensor('float32', out, [1, 3, REC_HEIGHT, w]), w };
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

/** 主入口：图片 dataURL → 多行文本 */
export async function recognizeImage(dataUrl: string): Promise<string> {
  await ensureOcrEngine();
  if (!detSession || !recSession) throw new Error('OCR 引擎未就绪');

  const { data, scale } = await loadImageData(dataUrl);
  const srcCanvas = toCanvas(data);
  const detInput = buildDetInput(data);
  const detOut = await detSession.run({ [detSession.inputNames[0]]: detInput.tensor });
  const detTensor = detOut[detSession.outputNames[0]];
  const dims = detTensor.dims as number[];
  const outH = dims[dims.length - 2];
  const outW = dims[dims.length - 1];
  const prob = detTensor.data as Float32Array;

  const boxes = sortReadingOrder(detectBoxes(prob, outW, outH));
  // det 输出的每个像素对应原图多少像素（PP-OCRv4 的 det 输出与输入同尺寸，
  // 仍乘上 w/outW 以防换成会下采样的模型）
  const boxScale = detInput.scale * (detInput.w / outW);
  const lines: string[] = [];
  for (const box of boxes) {
    const recInput = buildRecInput(srcCanvas, box, boxScale);
    const recOut = await recSession.run({ [recSession.inputNames[0]]: recInput.tensor });
    const recTensor = recOut[recSession.outputNames[0]];
    const rd = recTensor.dims as number[];
    const classes = rd[rd.length - 1];
    const steps = rd[rd.length - 2];
    const { text, score } = decodeCtc(recTensor.data as Float32Array, steps, classes);
    const clean = text.trim();
    if (clean && score >= REC_SCORE_MIN) lines.push(clean);
  }
  return lines.join('\n');
}
