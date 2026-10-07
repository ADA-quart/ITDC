import React, { useState } from 'react';
import { Button, ColorPicker, Popconfirm, Slider, Space, Switch, Upload, message } from 'antd';
import { BgColorsOutlined, DeleteOutlined, PictureOutlined, UploadOutlined } from '@ant-design/icons';
import { Capacitor } from '@capacitor/core';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../i18n';
import { useIsMobile } from '../hooks/useIsMobile';
import { sectionTitleStyle } from './ui';
import {
  ACCENT_PRESETS,
  compressImageToDataUrl,
  pushWidgetAppearance,
  resetPushedImageCache,
} from '../api/appearance';

/**
 * 外观设置页：主题色、应用背景图、桌面小组件配色。
 *
 * 改动即时生效并自动同步到小组件（非 Android 平台只影响应用本体），
 * 因此不需要「保存」按钮。
 */
const AppearanceSettings: React.FC = () => {
  const { t } = useI18n();
  const { isDark, appearance, updateAppearance, resetAppearance } = useTheme();
  const isMobile = useIsMobile();
  const [processing, setProcessing] = useState(false);
  const [applying, setApplying] = useState(false);

  const hintStyle: React.CSSProperties = {
    fontSize: 12,
    color: isDark ? '#999' : '#666',
    marginTop: 4,
    marginBottom: 8,
  };

  const handleImage = async (file: File) => {
    setProcessing(true);
    try {
      const dataUrl = await compressImageToDataUrl(file);
      // 换图后必须重新传一次给原生侧，否则小组件还在用旧图
      resetPushedImageCache();
      updateAppearance({ bgImage: dataUrl });
      message.success(t.settings.imageReady);
    } catch {
      message.error(t.settings.imageFailed);
    } finally {
      setProcessing(false);
    }
    return false;
  };

  const accentSwatches = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      {ACCENT_PRESETS.map((color) => {
        const active = appearance.accent.toUpperCase() === color.toUpperCase();
        return (
          <button
            key={color}
            type="button"
            aria-label={color}
            onClick={() => updateAppearance({ accent: color })}
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: color,
              cursor: 'pointer',
              border: active ? `2px solid ${isDark ? '#fff' : '#333'}` : '2px solid transparent',
              boxShadow: active ? '0 0 0 2px rgba(0,0,0,0.08)' : 'none',
            }}
          />
        );
      })}
      <ColorPicker
        value={appearance.accent}
        disabledAlpha
        showText
        onChangeComplete={(color) => updateAppearance({ accent: color.toHexString().toUpperCase() })}
      />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* ---------- 应用主题色 ---------- */}
      <div>
        <h4 style={sectionTitleStyle}>
          <BgColorsOutlined /> {t.settings.accentColor}
        </h4>
        <p style={hintStyle}>{t.settings.accentHint}</p>
        {accentSwatches}
      </div>

      {/* ---------- 背景图 ---------- */}
      <div>
        <h4 style={sectionTitleStyle}>
          <PictureOutlined /> {t.settings.backgroundImage}
        </h4>
        <p style={hintStyle}>{t.settings.backgroundImageHint}</p>

        <Space wrap align='center' style={{ marginBottom: 12 }}>
          <Upload
            accept='image/*'
            showUploadList={false}
            beforeUpload={(file) => { void handleImage(file as unknown as File); return false; }}
          >
            <Button icon={<UploadOutlined />} loading={processing}>
              {appearance.bgImage ? t.settings.replaceImage : t.settings.uploadImage}
            </Button>
          </Upload>
          {appearance.bgImage && (
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={() => updateAppearance({ bgImage: null, widgetUseBgImage: false })}
            >
              {t.settings.removeImage}
            </Button>
          )}
        </Space>

        {appearance.bgImage && (
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 16 }}>
            <div
              style={{
                width: isMobile ? '100%' : 180,
                height: 110,
                borderRadius: 8,
                backgroundImage: `url(${appearance.bgImage})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                border: `1px solid ${isDark ? '#303030' : '#e8e8e8'}`,
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13 }}>{t.settings.backgroundOpacity}</div>
              <Slider
                min={10}
                max={100}
                value={appearance.bgOpacity}
                onChange={(value) => updateAppearance({ bgOpacity: value })}
              />
              <div style={{ fontSize: 13 }}>{t.settings.backgroundBlur}</div>
              <Slider
                min={0}
                max={20}
                value={appearance.bgBlur}
                onChange={(value) => updateAppearance({ bgBlur: value })}
              />
            </div>
          </div>
        )}
      </div>

      {/* ---------- 小组件外观 ---------- */}
      <div>
        <h4 style={sectionTitleStyle}>{t.settings.widgetStyle}</h4>
        <p style={hintStyle}>
          {Capacitor.isNativePlatform() ? t.settings.widgetNativeHint : t.settings.widgetWebHint}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
          <div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>{t.settings.widgetFollowAccent}</div>
            <Switch
              checked={appearance.widgetFollowAccent}
              onChange={(checked) => updateAppearance({ widgetFollowAccent: checked })}
            />
          </div>

          {!appearance.widgetFollowAccent && (
            <div>
              <div style={{ fontSize: 13, marginBottom: 4 }}>{t.settings.widgetAccent}</div>
              <ColorPicker
                value={appearance.widgetAccent}
                disabledAlpha
                showText
                onChangeComplete={(color) =>
                  updateAppearance({ widgetAccent: color.toHexString().toUpperCase() })}
              />
            </div>
          )}

          <div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>{t.settings.widgetPanelColor}</div>
            <Space wrap>
              <ColorPicker
                value={appearance.widgetPanelColor ?? (isDark ? '#1C1C20' : '#FFFFFF')}
                disabledAlpha
                showText
                onChangeComplete={(color) =>
                  updateAppearance({ widgetPanelColor: color.toHexString().toUpperCase() })}
              />
              <Button
                size='small'
                disabled={appearance.widgetPanelColor === null}
                onClick={() => updateAppearance({ widgetPanelColor: null })}
              >
                {t.settings.widgetPanelAuto}
              </Button>
            </Space>
          </div>

          <div>
            <div style={{ fontSize: 13 }}>{t.settings.widgetPanelOpacity}</div>
            <Slider
              min={0}
              max={100}
              value={appearance.widgetPanelOpacity}
              onChange={(value) => updateAppearance({ widgetPanelOpacity: value })}
            />
          </div>

          <div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>{t.settings.widgetScheme}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['auto', 'light', 'dark'] as const).map((value) => (
                <Button
                  key={value}
                  size='small'
                  type={appearance.widgetScheme === value ? 'primary' : 'default'}
                  onClick={() => updateAppearance({ widgetScheme: value })}
                >
                  {value === 'auto' ? t.settings.system : value === 'light' ? t.settings.light : t.settings.dark}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>{t.settings.widgetUseBgImage}</div>
            <Switch
              disabled={!appearance.bgImage}
              checked={appearance.widgetUseBgImage && !!appearance.bgImage}
              onChange={(checked) => updateAppearance({ widgetUseBgImage: checked })}
            />
            {!appearance.bgImage && (
              <p style={{ ...hintStyle, marginTop: 6 }}>{t.settings.widgetUseBgImageFirst}</p>
            )}
          </div>

          <Space wrap>
            <Button
              loading={applying}
              onClick={async () => {
                setApplying(true);
                try {
                  await pushWidgetAppearance(appearance);
                  message.success(t.settings.widgetApplied);
                } catch {
                  message.error(t.settings.widgetApplyFailed);
                } finally {
                  setApplying(false);
                }
              }}
            >
              {t.settings.widgetApplyNow}
            </Button>
            <Popconfirm
              title={t.settings.appearanceReset}
              onConfirm={async () => {
                await resetAppearance();
                message.success(t.settings.appearanceResetDone);
              }}
            >
              <Button danger>{t.settings.appearanceReset}</Button>
            </Popconfirm>
          </Space>
        </div>
      </div>
    </div>
  );
};

export default AppearanceSettings;
