// 模型视觉能力判定：按「服务商::模型」记住第一次直发图片的结论。
//
// 判定策略（三层）：
//  1. 实测：第一次直发图片成功 = 支持；明确的「不支持图片」类错误 = 不支持；
//  2. 记忆：结论存 localStorage，换模型自动重新判定；
//  3. 手动：设置页可重置全部判定（误判兜底）。
const KEY = 'itdc_vision_support';

type Mark = 'yes' | 'no';
type Override = 'auto' | 'yes' | 'no';

interface Entry {
  /** 实测结论 */
  auto?: Mark;
  /** 手动覆盖（最高优先） */
  manual?: Override;
}

function load(): Record<string, Entry> {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function save(store: Record<string, Entry>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* 存不进去就算了，下次重新判定 */
  }
}

function keyOf(provider: string, model: string): string {
  return `${provider}::${model}`;
}

export function getVisionOverride(provider: string, model: string): Override {
  return load()[keyOf(provider, model)]?.manual ?? 'auto';
}

export function setVisionOverride(provider: string, model: string, value: Override): void {
  const store = load();
  const k = keyOf(provider, model);
  store[k] = { ...store[k], manual: value };
  save(store);
}

/** 当前结论：手动覆盖 > 实测记忆 > 未知 */
export function getVisionSupport(provider: string, model: string): Mark | 'unknown' {
  const entry = load()[keyOf(provider, model)];
  if (!entry) return 'unknown';
  if (entry.manual === 'yes' || entry.manual === 'no') return entry.manual;
  return entry.auto ?? 'unknown';
}

export function rememberVisionSupport(provider: string, model: string, mark: Mark): void {
  const store = load();
  const k = keyOf(provider, model);
  store[k] = { ...store[k], auto: mark };
  save(store);
}

/** 是否有任何已记录的判定（设置页据此显示重置入口） */
export function hasVisionRecords(): boolean {
  return Object.keys(load()).length > 0;
}

export function resetVisionSupport(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * 是否为「模型不支持图片输入」的错误。
 * 特征：HTTP 400/422 且文案提到 image/vision/多模态——而不是网络或配额问题。
 */
export function isVisionUnsupportedError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err || '');
  return /\b(400|422)\b/.test(msg)
    && /image|vision|multimodal|图片|多模态|content[- _]?type/i.test(msg);
}
