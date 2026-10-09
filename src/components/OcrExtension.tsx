import React, { useEffect, useState } from 'react';
import { Button, Popconfirm, Progress, Space, message } from 'antd';
import { CloudDownloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { useI18n } from '../i18n';
import { sectionTitleStyle, secondaryTextColor } from './ui';
import { useTheme } from '../contexts/ThemeContext';
import {
  OCR_TOTAL_BYTES,
  formatBytes,
  installOcr,
  ocrStatus,
  refreshLocalOcrState,
  uninstallLocalOcr,
} from '../api/local-ocr';
import type { OcrStatus } from '../api/local-ocr';

/**
 * 离线 OCR 扩展（PP-OCRv4 + onnxruntime-web）。
 *
 * 不打包进 APK 的原因：运行时 wasm 13.6MB + 两个模型 15.6MB，直接进包会给
 * 不用这个功能的用户白加 30MB。下载完成后全程离线（无 GMS 依赖），
 * 用于「图片 → 待办」在模型不支持视觉 / 没网时的降级识别。
 */
const OcrExtension: React.FC = () => {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const [status, setStatus] = useState<OcrStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);
  const [current, setCurrent] = useState('');

  useEffect(() => {
    void (async () => {
      setStatus(await ocrStatus());
      await refreshLocalOcrState();
    })();
  }, []);

  const hintStyle: React.CSSProperties = {
    fontSize: 12,
    color: secondaryTextColor(isDark),
    marginTop: 4,
    marginBottom: 12,
  };

  const download = async () => {
    setBusy(true);
    setPercent(0);
    setCurrent('');
    try {
      await installOcr((p) => {
        setPercent(p.percent);
        setCurrent(p.fileName);
      });
      await refreshLocalOcrState();
      setStatus(await ocrStatus());
      setPercent(100);
      message.success(t.ocr.installed);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      message.error(`${t.ocr.installFailed}：${detail}`);
    } finally {
      setBusy(false);
      setCurrent('');
    }
  };

  const installed = status?.installed ?? false;

  return (
    <div>
      <h4 style={sectionTitleStyle}>{t.ocr.title}</h4>
      <p style={hintStyle}>{t.ocr.hint.replace('{size}', formatBytes(OCR_TOTAL_BYTES))}</p>
      <Space direction='vertical' style={{ width: '100%' }} size={8}>
        <div style={{ fontSize: 13 }}>
          {installed
            ? t.ocr.stateInstalled.replace('{size}', formatBytes(status?.bytes ?? 0))
            : t.ocr.stateMissing}
        </div>
        {busy && (
          <div style={{ maxWidth: 420 }}>
            <Progress percent={percent} size='small' status='active' />
            <div style={{ fontSize: 11, color: secondaryTextColor(isDark) }}>{current}</div>
          </div>
        )}
        <Space wrap>
          {!installed && (
            <Button type='primary' icon={<CloudDownloadOutlined />} loading={busy} onClick={() => void download()}>
              {t.ocr.download.replace('{size}', formatBytes(OCR_TOTAL_BYTES))}
            </Button>
          )}
          {installed && (
            <Popconfirm
              title={t.ocr.removeConfirm}
              onConfirm={async () => {
                await uninstallLocalOcr();
                setStatus(await ocrStatus());
                setPercent(0);
                message.success(t.ocr.removed);
              }}
            >
              <Button danger icon={<DeleteOutlined />}>
                {t.ocr.remove}
              </Button>
            </Popconfirm>
          )}
        </Space>
        <p style={{ ...hintStyle, marginBottom: 0 }}>{t.ocr.fallbackNote}</p>
      </Space>
    </div>
  );
};

export default OcrExtension;
