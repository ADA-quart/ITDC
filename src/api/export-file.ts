/**
 * 导出文件：原生平台写进缓存目录再弹系统分享面板，浏览器保持普通下载。
 *
 * 为什么不直接用 <a download>：Android WebView 不支持 blob: 下载，Capacitor 也没接管
 * 下载（源码里没有 DownloadListener / DownloadManager），手机上点了不会生成任何文件。
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { downloadBlob } from './local-ical';

/** Blob → base64（Filesystem.writeFile 用 base64 传二进制） */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000; // 分块拼接，避免超长参数把 String.fromCharCode 撑爆
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * 交付导出文件。
 * 原生：写入缓存目录 → 系统分享面板（存到文件、发微信、传电脑都行）
 * 浏览器：常规下载，落在浏览器下载目录
 */
export async function exportFile(blob: Blob, filename: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    downloadBlob(blob, filename);
    return;
  }
  const written = await Filesystem.writeFile({
    path: filename,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
  });
  await Share.share({
    title: filename,
    url: written.uri,
    dialogTitle: filename,
  });
}
