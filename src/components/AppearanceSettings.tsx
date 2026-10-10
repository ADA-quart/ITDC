import React, { useEffect, useRef, useState } from 'react';
import { Button, ColorPicker, Popconfirm, Segmented, Slider, Space, Switch, Upload, message } from 'antd';
import { BgColorsOutlined, DeleteOutlined, PictureOutlined, UploadOutlined } from '@ant-design/icons';
import { Capacitor } from '@capacitor/core';
import { useTheme } from '../contexts/ThemeContext';
import type { CourseTextTone } from '../../shared/course-colors';
import { useI18n } from '../i18n';
import { useIsMobile } from '../hooks/useIsMobile';
import { secondaryTextColor, sectionTitleStyle } from './ui';
import {
  ACCENT_PRESETS,
  MAX_BG_ZOOM,
  MIN_BG_ZOOM,
  compressImageToDataUrl,
  pushWidgetAppearance,
  resetPushedImageCache,
} from '../api/appearance';

/**
 * 预览用的打底层：缩放小于 1 倍时，App 背景与小组件都会在图片四周
 * 铺一层模糊放大的同图，预览里也要有，否则看不出真实效果（还会露白底）。
 */
const PreviewBackdrop: React.FC<{
  image: string;
  focusX: number;
  focusY: number;
  zoom: number;
}> = ({ image, focusX, focusY, zoom }) =>
  zoom < 1 ? (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `url(${image})`,
        backgroundSize: 'cover',
        backgroundPosition: `${focusX}% ${focusY}%`,
        backgroundRepeat: 'no-repeat',
        filter: 'blur(16px)',
        transform: 'scale(1.25)',
        pointerEvents: 'none',
      }}
    />
  ) : null;

/** 滑杆标题行：右侧显示当前值——只有滑块位置时，用户分不清是「调到头了」还是「没生效」 */
const SliderLabel: React.FC<{ label: string; value: string; dim: string }> = ({ label, value, dim }) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: 8,
      fontSize: 13,
      marginTop: 8,
    }}
  >
    <span>{label}</span>
    <span style={{ color: dim, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
  </div>
);

/**
 * 外观设置页：主题色、应用背景图、桌面小组件配色。
 *
 * 改动即时生效并自动同步到小组件（非 Android 平台只影响应用本体），
 * 因此不需要「保存」按钮。
 */
const AppearanceSettings: React.FC = () => {
  const { t } = useI18n();
  const { isDark, mode, setMode, appearance, updateAppearance, resetAppearance, resetWidgetAppearance } = useTheme();
  const isMobile = useIsMobile();
  const [processing, setProcessing] = useState(false);
  const [applying, setApplying] = useState(false);
  const dragRef = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null);
  // 预览框必须和真实屏幕同比例：横着的预览框里看到的是另一块区域，
  // 用户没法判断图片实际会被裁成什么样（之前只能靠猜）
  const [viewAspect, setViewAspect] = useState(() =>
    typeof window === 'undefined' ? 9 / 19.5 : window.innerWidth / Math.max(1, window.innerHeight),
  );
  useEffect(() => {
    const onResize = () => setViewAspect(window.innerWidth / Math.max(1, window.innerHeight));
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  // 宽度取上限、高度反推：手机上就是一块竖向的屏幕形状
  // 手机上再给高度封顶（240px）：预览要跟滑条同屏才能边拖边看，
  // 太高会把整列滑条挤到屏幕外，调参数时看不见预览。
  const rawPreviewWidth = Math.min(isMobile ? 230 : 190, Math.round(320 * viewAspect));
  const rawPreviewHeight = Math.max(90, Math.round(rawPreviewWidth / Math.max(0.2, viewAspect)));
  const previewHeight = isMobile ? Math.min(240, rawPreviewHeight) : rawPreviewHeight;
  const previewWidth = isMobile ? Math.round(previewHeight * viewAspect) : rawPreviewWidth;
  const clampFocus = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  // 取成局部常量，闭包（.map 等）里也能拿到非空类型
  const bgImage = appearance.bgImage;

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
    <>
      {/* 固定成 N 列不换行：色块等分整行，永远不会挤到第二行 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${ACCENT_PRESETS.length}, minmax(0, 1fr))`,
          gap: 6,
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
      {ACCENT_PRESETS.map(({ hex: color, name }) => {
        const active = appearance.accent.toUpperCase() === color.toUpperCase();
        return (
          <button
            key={color}
            type="button"
            aria-label={`${name} ${color}`}
            title={`${name} ${color}`}
            onClick={() => updateAppearance({ accent: color })}
            style={{
              width: '100%',
              aspectRatio: '1',
              borderRadius: '50%',
              background: color,
              cursor: 'pointer',
              border: active ? `2px solid ${isDark ? '#fff' : '#333'}` : '2px solid transparent',
              boxShadow: active ? '0 0 0 2px rgba(0,0,0,0.08)' : 'none',
            }}
          />
        );
      })}
      </div>
      <ColorPicker
        value={appearance.accent}
        disabledAlpha
        showText
        onChangeComplete={(color) => updateAppearance({ accent: color.toHexString().toUpperCase() })}
      />
    </>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* ---------- 明暗模式（从通用设置挪到外观） ---------- */}
      <div>
        <h4 style={sectionTitleStyle}>{t.settings.theme}</h4>
        <Segmented
          value={mode}
          onChange={(value) => setMode(value as 'light' | 'dark' | 'system')}
          options={[
            { value: 'light', label: t.settings.light },
            { value: 'dark', label: t.settings.dark },
            { value: 'system', label: t.settings.system },
          ]}
        />
      </div>

      {/* ---------- 液态玻璃 ---------- */}
      <div>
        <h4 style={sectionTitleStyle}>{t.settings.liquidGlass}</h4>
        <Switch
          checked={appearance.liquidGlass}
          onChange={(checked) => updateAppearance({ liquidGlass: checked })}
        />
        <p style={{ ...hintStyle, marginTop: 8 }}>{t.settings.liquidGlassHint}</p>
      </div>

      {/* ---------- 课块字色档位 ---------- */}
      <div>
        <h4 style={sectionTitleStyle}>{t.settings.courseTextTone}</h4>
        <Segmented
          value={appearance.courseTextTone}
          onChange={(value) => updateAppearance({ courseTextTone: value as CourseTextTone })}
          options={[
            { value: 'ink', label: t.settings.toneInk },
            { value: 'white', label: t.settings.toneWhite },
            { value: 'black', label: t.settings.toneBlack },
          ]}
        />
        <p style={{ ...hintStyle, marginTop: 8 }}>{t.settings.courseTextToneHint}</p>
      </div>

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
          {bgImage && (
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={() => updateAppearance({ bgImage: null, widgetUseBgImage: false })}
            >
              {t.settings.removeImage}
            </Button>
          )}
        </Space>

        {bgImage && (
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <div
              onPointerDown={(e) => {
                dragRef.current = {
                  x: e.clientX,
                  y: e.clientY,
                  fx: appearance.bgFocusX,
                  fy: appearance.bgFocusY,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const drag = dragRef.current;
                if (!drag) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const dx = ((e.clientX - drag.x) / Math.max(1, rect.width)) * 100;
                const dy = ((e.clientY - drag.y) / Math.max(1, rect.height)) * 100;
                updateAppearance({
                  bgFocusX: clampFocus(drag.fx - dx),
                  bgFocusY: clampFocus(drag.fy - dy),
                });
              }}
              onPointerUp={() => { dragRef.current = null; }}
              onPointerCancel={() => { dragRef.current = null; }}
              style={{
                  position: 'relative',
                  width: previewWidth,
                  height: previewHeight,
                  borderRadius: isMobile ? 14 : 8,
                  overflow: 'hidden',
                  border: `1px solid ${isDark ? '#303030' : '#e8e8e8'}`,
                  cursor: 'grab',
                  touchAction: 'none',
                }}
              >
                <PreviewBackdrop
                  image={bgImage}
                  focusX={appearance.bgFocusX}
                  focusY={appearance.bgFocusY}
                  zoom={appearance.bgZoom}
                />
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundImage: `url(${appearance.bgImage})`,
                    backgroundSize: 'cover',
                    backgroundPosition: `${appearance.bgFocusX}% ${appearance.bgFocusY}%`,
                    backgroundRepeat: 'no-repeat',
                    transform: `scale(${appearance.bgZoom})`,
                    transformOrigin: `${appearance.bgFocusX}% ${appearance.bgFocusY}%`,
                    pointerEvents: 'none',
                  }}
                />
              </div>
              {!isMobile && (
                <div style={{ fontSize: 11, color: secondaryTextColor(isDark) }}>
                  {t.settings.previewScreenRatio}
                </div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* ① 裁切与取景：先把画面取好，再看后面两层观感 */}
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t.settings.cropGroup}</div>
              <SliderLabel label={t.settings.imageZoom} value={`${appearance.bgZoom.toFixed(2)}×`} dim={secondaryTextColor(isDark)} />
              <Slider
                min={MIN_BG_ZOOM}
                max={MAX_BG_ZOOM}
                step={0.05}
                value={appearance.bgZoom}
                onChange={(value) => updateAppearance({ bgZoom: value })}
              />
              <SliderLabel label={t.settings.focusHorizontal} value={`${appearance.bgFocusX}%`} dim={secondaryTextColor(isDark)} />
              <Slider
                min={0}
                max={100}
                value={appearance.bgFocusX}
                onChange={(value) => updateAppearance({ bgFocusX: value })}
              />
              <SliderLabel label={t.settings.focusVertical} value={`${appearance.bgFocusY}%`} dim={secondaryTextColor(isDark)} />
              <Slider
                min={0}
                max={100}
                value={appearance.bgFocusY}
                onChange={(value) => updateAppearance({ bgFocusY: value })}
              />
              <div style={{ ...hintStyle, marginTop: 6 }}>{t.settings.imageZoomHint}</div>
              <div style={{ ...hintStyle, marginTop: 0 }}>{t.settings.focusHint}</div>

              {/* ② 壁纸层：只影响背景图自己 */}
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 16 }}>{t.settings.wallpaperGroup}</div>
              <SliderLabel label={t.settings.backgroundOpacity} value={`${appearance.bgOpacity}%`} dim={secondaryTextColor(isDark)} />
              <Slider
                min={10}
                max={100}
                value={appearance.bgOpacity}
                onChange={(value) => updateAppearance({ bgOpacity: value })}
              />
              <SliderLabel label={t.settings.backgroundBlur} value={`${appearance.bgBlur}px`} dim={secondaryTextColor(isDark)} />
              <Slider
                min={0}
                max={20}
                value={appearance.bgBlur}
                onChange={(value) => updateAppearance({ bgBlur: value })}
              />
              <div style={{ ...hintStyle, marginTop: 6 }}>{t.settings.backgroundOpacityHint}</div>

              {/* ③ 面板层：日历 / 卡片 / 导航这层的实心程度 */}
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 16 }}>{t.settings.panelGroup}</div>
              <SliderLabel label={t.settings.uiOpacity} value={`${appearance.uiOpacity}%`} dim={secondaryTextColor(isDark)} />
              <Slider
                min={0}
                max={100}
                value={appearance.uiOpacity}
                onChange={(value) => updateAppearance({ uiOpacity: value })}
              />
              <SliderLabel label={t.settings.uiBlur} value={`${appearance.uiBlur}px`} dim={secondaryTextColor(isDark)} />
              <Slider
                min={0}
                max={20}
                value={appearance.uiBlur}
                onChange={(value) => updateAppearance({ uiBlur: value })}
              />
              <div style={{ ...hintStyle, marginTop: 6 }}>{t.settings.uiOpacityHint}</div>
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
            <SliderLabel label={t.settings.widgetPanelOpacity} value={`${appearance.widgetPanelOpacity}%`} dim={secondaryTextColor(isDark)} />
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

          {bgImage && (
            <div>
              <div style={{ fontSize: 13, marginBottom: 4 }}>{t.settings.widgetCropPreview}</div>
              <div style={{ display: 'flex', gap: 10 }}>
                {[{ label: '4×2', ratio: '2 / 1' }, { label: '4×4', ratio: '1 / 1' }].map((preset) => (
                  <div key={preset.label} style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        position: 'relative',
                        aspectRatio: preset.ratio,
                        borderRadius: 10,
                        overflow: 'hidden',
                        border: `1px solid ${isDark ? '#303030' : '#e8e8e8'}`,
                      }}
                    >
                      <PreviewBackdrop
                        image={bgImage}
                        focusX={appearance.bgFocusX}
                        focusY={appearance.bgFocusY}
                        zoom={appearance.bgZoom}
                      />
                      <div
                        aria-hidden
                        style={{
                          position: 'absolute',
                          inset: 0,
                          backgroundImage: `url(${bgImage})`,
                          backgroundSize: 'cover',
                          backgroundPosition: `${appearance.bgFocusX}% ${appearance.bgFocusY}%`,
                          backgroundRepeat: 'no-repeat',
                          transform: `scale(${appearance.bgZoom})`,
                          transformOrigin: `${appearance.bgFocusX}% ${appearance.bgFocusY}%`,
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 11, textAlign: 'center', color: secondaryTextColor(isDark) }}>
                      {preset.label}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ ...hintStyle, marginTop: 6 }}>{t.settings.widgetCropHint}</div>
            </div>
          )}

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
              title={t.settings.widgetResetConfirm}
              onConfirm={() => {
                resetWidgetAppearance();
                message.success(t.settings.widgetResetDone);
              }}
            >
              <Button>{t.settings.widgetReset}</Button>
            </Popconfirm>
          </Space>
        </div>
      </div>

      {/* ---------- 恢复全部外观 ---------- */}
      <div>
        <h4 style={sectionTitleStyle}>{t.settings.appearanceReset}</h4>
        <p style={hintStyle}>{t.settings.appearanceResetHint}</p>
        <Popconfirm
          title={t.settings.appearanceResetConfirm}
          onConfirm={async () => {
            await resetAppearance();
            message.success(t.settings.appearanceResetDone);
          }}
        >
          <Button danger>{t.settings.appearanceReset}</Button>
        </Popconfirm>
      </div>
    </div>
  );
};

export default AppearanceSettings;
