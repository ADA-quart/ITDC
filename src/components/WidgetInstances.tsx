// © 2026 ADA-Quart & TyTs · 日日新（ITDC）· PolyForm Noncommercial 1.0.0 · github.com/ADA-quart/ITDC

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Segmented, Select, Slider, Upload, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { Capacitor } from '@capacitor/core';
import { ITDCWidgetPlugin } from '../capacitor/itdc-widget';
import { useI18n } from '../i18n';
import { MAX_BG_ZOOM, MIN_BG_ZOOM, compressImageToDataUrl } from '../api/appearance';
import {
  getCountdownPins,
  pruneCountdownPins,
  pushWidgetSnapshot,
  setCountdownPinForWidget,
} from '../api/widget-sync';
import { todoApi } from '../api/client';
import type { Todo } from '../types';
import { secondaryTextColor } from './ui';
import { useTheme } from '../contexts/ThemeContext';

interface WidgetInstance {
  id: number;
  kind: string;
  w: number;
  h: number;
  bgMode: number;
  focusX: number;
  focusY: number;
  zoom: number;
  blur: number;
}

/** 同类多个实例时用序号区分（待办课表 ① / 倒计时 ②）；各桌面格数算法不同，就不猜了 */
const ORDINALS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];

/**
 * 桌面小组件实例列表：每个实例单独配背景图（跟随全局 / 不用图 / 专属图），
 * 倒计时实例还能单独指定目标——想摆几个倒计时就摆几个，各看各的。
 */
const WidgetInstances: React.FC = () => {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const [instances, setInstances] = useState<WidgetInstance[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [pins, setPins] = useState<Record<string, number>>(() => getCountdownPins());
  const [todos, setTodos] = useState<Todo[]>([]);
  /** 本次会话里刚上传的实例图：原生侧不回传原图，只用于即时预览 */
  const [preview, setPreview] = useState<Record<number, string>>({});
  /** 滑杆拖动中的草稿值（原生调用只在松手时发一次）：key = `${id}:${字段}` */
  const [draft, setDraft] = useState<Record<string, number>>({});
  const draftValue = (id: number, key: 'zoom' | 'focusX' | 'focusY' | 'blur', base: number) =>
    draft[`${id}:${key}`] ?? base;
  const setDraftValue = (id: number, key: 'zoom' | 'focusX' | 'focusY' | 'blur', value: number) =>
    setDraft((prev) => ({ ...prev, [`${id}:${key}`]: value }));
  const clearDraftValue = (id: number, key: 'zoom' | 'focusX' | 'focusY' | 'blur') =>
    setDraft((prev) => {
      const next = { ...prev };
      delete next[`${id}:${key}`];
      return next;
    });

  const rebase = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const { widgets } = await ITDCWidgetPlugin.listWidgetInstances();
      setInstances(widgets);
      pruneCountdownPins(widgets.map((w) => w.id));
      setPins(getCountdownPins());
    } catch {
      setInstances([]);
    }
  }, []);

  useEffect(() => {
    void rebase();
  }, [rebase]);

  useEffect(() => {
    void todoApi
      .getAll()
      .then((list) => {
        // 选择器只列「还有未来时刻」的待办：开始 / 结束 / 截止都过了的选它当目标，
        // 小组件会静默退回最近一条，体验很怪。当前已指定过的例外保留，方便改掉。
        const now = Date.now();
        const pinned = new Set(Object.values(getCountdownPins()));
        const hasFuture = (td: Todo) =>
          (td.scheduled_start ? new Date(td.scheduled_start).getTime() > now : false) ||
          (td.scheduled_end ? new Date(td.scheduled_end).getTime() > now : false) ||
          (td.deadline ? new Date(td.deadline).getTime() > now : false);
        setTodos(list.filter((td) => td.status !== 'done' && (hasFuture(td) || pinned.has(td.id))));
      })
      .catch(() => {
        /* 拿不到待办列表只影响目标选择，不影响背景图设置 */
      });
  }, []);

  const dim = secondaryTextColor(isDark);
  const small = { fontSize: 12, color: dim } as const;

  const kindLabel = (kind: string) =>
    kind === 'countdown'
      ? t.settings.widgetKindCountdown
      : kind === 'pure'
        ? t.settings.widgetKindPure
        : kind === 'small'
          ? t.settings.widgetKindSmall
          : t.settings.widgetKindStandard;

  const applyBackground = async (
    widget: WidgetInstance,
    next: Partial<Pick<WidgetInstance, 'focusX' | 'focusY' | 'zoom' | 'blur'>> & {
      mode?: 'inherit' | 'none' | 'custom';
      image?: string;
    },
  ) => {
    if (!Capacitor.isNativePlatform()) return;
    const mode = next.mode ?? (widget.bgMode === 2 ? 'custom' : widget.bgMode === 1 ? 'none' : 'inherit');
    try {
      await ITDCWidgetPlugin.setWidgetBackground({
        id: widget.id,
        mode,
        image: next.image,
        focusX: next.focusX ?? widget.focusX,
        focusY: next.focusY ?? widget.focusY,
        zoom: next.zoom ?? widget.zoom,
        blur: next.blur ?? widget.blur,
      });
      setInstances((prev) =>
        prev
          ? prev.map((it) =>
              it.id === widget.id
                ? {
                    ...it,
                    bgMode: mode === 'custom' ? 2 : mode === 'none' ? 1 : 0,
                    focusX: next.focusX ?? it.focusX,
                    focusY: next.focusY ?? it.focusY,
                    zoom: next.zoom ?? it.zoom,
                    blur: next.blur ?? it.blur,
                  }
                : it,
            )
          : prev,
      );
    } catch {
      message.error(t.settings.widgetInstanceFailed);
    }
  };

  if (!Capacitor.isNativePlatform()) return null;

  return (
    <div>
      <div style={{ fontSize: 13, marginBottom: 4 }}>{t.settings.widgetInstances}</div>
      <div style={{ ...small, marginBottom: 8 }}>{t.settings.widgetInstancesHint}</div>

      {instances === null ? null : instances.length === 0 ? (
        <div style={{ ...small, padding: '8px 0' }}>{t.settings.widgetInstanceNone}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {instances.map((widget, index) => {
            const isCountdown = widget.kind === 'countdown';
            const before = instances.slice(0, index).filter((it) => it.kind === widget.kind).length;
            const kindCount = instances.filter((it) => it.kind === widget.kind).length;
            const ordinal =
              kindCount > 1 ? ` ${ORDINALS[Math.min(before, ORDINALS.length - 1)]}` : '';
            const target = pins[String(widget.id)];
            const targetTodo = target !== undefined ? todos.find((td) => td.id === target) : undefined;
            const targetLabel = targetTodo
              ? targetTodo.title
              : target !== undefined
                ? t.settings.widgetTargetMissing
                : t.settings.widgetTargetAuto;
            const open = openId === widget.id;
            const image = preview[widget.id];
            return (
              <div
                key={widget.id}
                style={{
                  border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
                  borderRadius: 12,
                  padding: '8px 10px',
                }}
              >
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}
                  onClick={() => setOpenId(open ? null : widget.id)}
                >
                  <span style={{ fontSize: 13 }}>
                    {kindLabel(widget.kind)}
                    {ordinal}
                    {isCountdown ? ` · ${targetLabel}` : ''}
                  </span>
                  <span style={{ ...small, whiteSpace: 'nowrap' }}>
                    {open ? t.settings.widgetInstanceCollapse : t.settings.widgetInstanceTitle}
                  </span>
                </div>

                {open && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div>
                      <div style={{ ...small, marginBottom: 4 }}>{t.settings.widgetInstanceBg}</div>
                      <Segmented
                        size='small'
                        value={widget.bgMode}
                        onChange={(value) => {
                          const mode = value === 2 ? 'custom' : value === 1 ? 'none' : 'inherit';
                          void applyBackground(widget, { mode });
                        }}
                        options={[
                          { label: t.settings.widgetBgInherit, value: 0 },
                          { label: t.settings.widgetBgNone, value: 1 },
                          { label: t.settings.widgetBgCustom, value: 2 },
                        ]}
                      />
                    </div>

                    {widget.bgMode === 2 && (
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        {image ? (
                          <div
                            aria-hidden
                            style={{
                              width: 84,
                              height: 84,
                              borderRadius: 10,
                              overflow: 'hidden',
                              flex: '0 0 auto',
                              backgroundImage: `url(${image})`,
                              backgroundSize: 'cover',
                              backgroundPosition: `${widget.focusX}% ${widget.focusY}%`,
                              transform: 'translateZ(0)',
                            }}
                          />
                        ) : (
                          <div style={{ ...small, alignSelf: 'center' }}>
                            {t.settings.widgetInstanceImageSet}
                          </div>
                        )}
                        <div style={{ flex: '1 1 180px', minWidth: 180 }}>
                          <Upload
                            accept='image/*'
                            showUploadList={false}
                            beforeUpload={(file) => {
                              void (async () => {
                                try {
                                  const dataUrl = await compressImageToDataUrl(file as File);
                                  setPreview((prev) => ({ ...prev, [widget.id]: dataUrl }));
                                  await applyBackground(widget, { mode: 'custom', image: dataUrl });
                                  message.success(t.settings.widgetInstanceImageOk);
                                } catch {
                                  message.error(t.settings.widgetInstanceFailed);
                                }
                              })();
                              return false;
                            }}
                          >
                            <Button size='small' icon={<UploadOutlined />}>
                              {image
                                ? t.settings.widgetInstanceReplaceImage
                                : t.settings.widgetInstancePickImage}
                            </Button>
                          </Upload>
                        </div>
                      </div>
                    )}

                    {widget.bgMode === 2 && (
                      <div style={{ maxWidth: 420 }}>
                        <div style={small}>{t.settings.imageZoom}</div>
                        <Slider
                          min={MIN_BG_ZOOM}
                          max={MAX_BG_ZOOM}
                          step={0.05}
                          value={draftValue(widget.id, 'zoom', widget.zoom)}
                          onChange={(value) => setDraftValue(widget.id, 'zoom', value)}
                          onChangeComplete={(value) => {
                            clearDraftValue(widget.id, 'zoom');
                            void applyBackground(widget, { zoom: value });
                          }}
                        />
                        <div style={small}>{t.settings.focusHorizontal}</div>
                        <Slider
                          min={0}
                          max={100}
                          value={draftValue(widget.id, 'focusX', widget.focusX)}
                          onChange={(value) => setDraftValue(widget.id, 'focusX', value)}
                          onChangeComplete={(value) => {
                            clearDraftValue(widget.id, 'focusX');
                            void applyBackground(widget, { focusX: value });
                          }}
                        />
                        <div style={small}>{t.settings.focusVertical}</div>
                        <Slider
                          min={0}
                          max={100}
                          value={draftValue(widget.id, 'focusY', widget.focusY)}
                          onChange={(value) => setDraftValue(widget.id, 'focusY', value)}
                          onChangeComplete={(value) => {
                            clearDraftValue(widget.id, 'focusY');
                            void applyBackground(widget, { focusY: value });
                          }}
                        />
                        <div style={small}>{t.settings.widgetImageBlur}</div>
                        <Slider
                          min={0}
                          max={20}
                          value={draftValue(widget.id, 'blur', widget.blur)}
                          onChange={(value) => setDraftValue(widget.id, 'blur', value)}
                          onChangeComplete={(value) => {
                            clearDraftValue(widget.id, 'blur');
                            void applyBackground(widget, { blur: value });
                          }}
                        />
                      </div>
                    )}

                    {isCountdown && (
                      <div>
                        <div style={{ ...small, marginBottom: 4 }}>{t.settings.widgetInstanceTarget}</div>
                        <Select
                          size='small'
                          style={{ minWidth: 200, maxWidth: '100%' }}
                          value={target ?? 0}
                          onChange={(value) => {
                            setCountdownPinForWidget(widget.id, value === 0 ? null : Number(value));
                            setPins(getCountdownPins());
                            void pushWidgetSnapshot();
                          }}
                          options={[
                            { value: 0, label: t.settings.widgetTargetAuto },
                            ...todos.map((td) => ({ value: td.id, label: td.title })),
                          ]}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WidgetInstances;
