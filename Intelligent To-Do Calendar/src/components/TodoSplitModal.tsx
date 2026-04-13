import React, { useState, useEffect } from 'react';
import { Modal, InputNumber, DatePicker, Button, Space, message, Radio } from 'antd';
import { PlusOutlined, MinusCircleOutlined, ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { todoApi, scheduleApi } from '../api/client';
import type { Todo } from '../types';
import { useI18n } from '../i18n';
import { useTheme } from '../contexts/ThemeContext';

interface Props {
  todo: Todo | null;
  onClose: () => void;
  onSaved: () => void;
}

interface Segment {
  start: dayjs.Dayjs;
  end: dayjs.Dayjs;
}

const TodoSplitModal: React.FC<Props> = ({ todo, onClose, onSaved }) => {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const [splitMode, setSplitMode] = useState<'manual' | 'smart'>('manual');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [segmentCount, setSegmentCount] = useState(2);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (todo) {
      const start = todo.scheduled_start ? dayjs(todo.scheduled_start) : dayjs();
      const end = todo.scheduled_end ? dayjs(todo.scheduled_end) : dayjs().add(todo.estimated_minutes, 'minute');
      setSegments([{ start, end }]);
    }
  }, [todo]);

  if (!todo) return null;

  const addSegment = () => {
    const lastEnd = segments.length > 0 ? segments[segments.length - 1].end : dayjs();
    setSegments([...segments, { start: lastEnd.add(15, 'minute'), end: lastEnd.add(15 + Math.ceil(todo.estimated_minutes / segmentCount), 'minute') }]);
  };

  const removeSegment = (index: number) => {
    if (segments.length <= 1) return;
    setSegments(segments.filter((_, i) => i !== index));
  };

  const updateSegment = (index: number, field: 'start' | 'end', value: dayjs.Dayjs) => {
    const updated = [...segments];
    updated[index] = { ...updated[index], [field]: value };
    setSegments(updated);
  };

  const handleSmartSplit = async () => {
    setLoading(true);
    try {
      const result = await scheduleApi.generate('algorithm');
      const todoSchedule = result.schedule.filter(s => s.todo_id === todo.id);
      if (todoSchedule.length > 0) {
        setSegments(todoSchedule.map(s => ({
          start: dayjs(s.start),
          end: dayjs(s.end),
        })));
        message.success(t.todo.smartSplitCompleted);
      } else {
        const totalMinutes = todo.estimated_minutes;
        const perSegment = Math.ceil(totalMinutes / segmentCount);
        const newSegments: Segment[] = [];
        let current = dayjs();
        for (let i = 0; i < segmentCount; i++) {
          newSegments.push({
            start: current,
            end: current.add(perSegment, 'minute'),
          });
          current = current.add(perSegment + 15, 'minute');
        }
        setSegments(newSegments);
        message.info(t.todo.autoSplitInfo.replaceAll('{n}', String(segmentCount)));
      }
    } catch {
      const totalMinutes = todo.estimated_minutes;
      const perSegment = Math.ceil(totalMinutes / segmentCount);
      const newSegments: Segment[] = [];
      let current = dayjs();
      for (let i = 0; i < segmentCount; i++) {
        newSegments.push({
          start: current,
          end: current.add(perSegment, 'minute'),
        });
        current = current.add(perSegment + 15, 'minute');
      }
      setSegments(newSegments);
    } finally {
      setLoading(false);
    }
  };

  const handleSmartLLMSplit = async () => {
    setLoading(true);
    try {
      const result = await scheduleApi.generate('llm');
      const todoSchedule = result.schedule.filter(s => s.todo_id === todo.id);
      if (todoSchedule.length > 0) {
        setSegments(todoSchedule.map(s => ({
          start: dayjs(s.start),
          end: dayjs(s.end),
        })));
        message.success(t.todo.llmSplitCompleted);
      } else {
        message.warning(t.todo.llmNoSplit);
      }
    } catch (err: any) {
      message.error(err?.response?.data?.error || t.todo.llmSplitFailed);
    } finally {
      setLoading(false);
    }
  };

  const handleManualSplit = () => {
    const totalMinutes = todo.estimated_minutes;
    const perSegment = Math.ceil(totalMinutes / segmentCount);
    const newSegments: Segment[] = [];
    let current = dayjs();
    for (let i = 0; i < segmentCount; i++) {
      newSegments.push({
        start: current,
        end: current.add(perSegment, 'minute'),
      });
      current = current.add(perSegment + 15, 'minute');
    }
    setSegments(newSegments);
  };

  const handleSave = async () => {
    if (segments.length === 0) return;
    setLoading(true);
    try {
      if (segments.length === 1) {
        await todoApi.update(todo.id, {
          status: 'scheduled',
          scheduled_start: segments[0].start.toISOString(),
          scheduled_end: segments[0].end.toISOString(),
        });
      } else {
        await todoApi.split(todo.id, segments.map(s => ({
          start: s.start.toISOString(),
          end: s.end.toISOString(),
        })));
      }
      message.success(t.todo.saved);
      onSaved();
      onClose();
    } catch (err: any) {
      message.error(err?.response?.data?.error || t.todo.saveFailed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t.todo.split + ' - ' + todo.title}
      open={!!todo}
      onCancel={onClose}
      onOk={handleSave}
      okText={t.todo.save}
      cancelText={t.todo.cancel}
      confirmLoading={loading}
      width={600}
    >
      <div style={{ marginBottom: 16 }}>
        <Radio.Group value={splitMode} onChange={e => setSplitMode(e.target.value)}>
          <Radio.Button value="manual">{t.todo.manualSplit}</Radio.Button>
          <Radio.Button value="smart">{t.todo.smartSplit}</Radio.Button>
        </Radio.Group>
      </div>

      {splitMode === 'manual' && (
        <div style={{ marginBottom: 16 }}>
          <Space>
            <span>{t.todo.splitSegments}:</span>
            <InputNumber
              min={2}
              max={10}
              value={segmentCount}
              onChange={v => setSegmentCount(v || 2)}
            />
            <Button onClick={handleManualSplit}>
              {t.todo.manualSplit}
            </Button>
          </Space>
        </div>
      )}

      {splitMode === 'smart' && (
        <div style={{ marginBottom: 16 }}>
          <Space>
            <Button icon={<ThunderboltOutlined />} onClick={handleSmartSplit} loading={loading}>
              {t.todo.smartSplit} ({t.todo.algorithm})
            </Button>
            <Button icon={<ThunderboltOutlined />} onClick={handleSmartLLMSplit} loading={loading}>
              {t.todo.smartSplit} (LLM)
            </Button>
          </Space>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {segments.map((seg, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, background: isDark ? '#303030' : '#fafafa', borderRadius: 4 }}>
            <span style={{ fontWeight: 'bold', minWidth: 24 }}>#{idx + 1}</span>
            <DatePicker
              showTime
              format="YYYY-MM-DD HH:mm"
              value={seg.start}
              onChange={v => v && updateSegment(idx, 'start', v)}
              style={{ flex: 1 }}
            />
            <span>~</span>
            <DatePicker
              showTime
              format="YYYY-MM-DD HH:mm"
              value={seg.end}
              onChange={v => v && updateSegment(idx, 'end', v)}
              style={{ flex: 1 }}
            />
            {segments.length > 1 && (
              <Button
                type="text"
                danger
                icon={<MinusCircleOutlined />}
                onClick={() => removeSegment(idx)}
              />
            )}
          </div>
        ))}
        <Button type="dashed" icon={<PlusOutlined />} onClick={addSegment} block>
          {t.todo.addSegment}
        </Button>
      </div>
    </Modal>
  );
};

export default TodoSplitModal;
