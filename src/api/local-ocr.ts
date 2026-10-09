// 本地 OCR（可选扩展）：模型按需下载，下载前不可用。
//
// 这是图片待办「降级链」的中间环节：图片直发失败（模型不支持视觉 /
// 没网）时，若本地 OCR 可用则改走「OCR 出文字 → 文本 AI 提取 →
// 仍失败则降级存原文」。
//
// 当前版本尚未实现下载式 OCR（bundled 模型会令 APK 增大 40MB+，
// 按需下载方案在后续版本接入）；届时只需替换本文件的实现，
// 调用方（TodoList.handleImagePick）无需改动。

export function isLocalOcrAvailable(): boolean {
  return false; // TODO(OCR 扩展)：检测模型是否已下载并校验通过
}

export async function recognizeTextLocally(_dataUrl: string): Promise<string> {
  throw new Error('本地 OCR 扩展尚未安装');
}
