import React, { useState } from 'react';
import { Button, Card, Radio, Tag, Alert, Spin, Empty, message } from 'antd';
import { ThunderboltOutlined, RobotOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { scheduleApi } from '../api/client';
import type { ScheduleResult, Priority } from '../types';
import { PRIORITY_COLORS } from '../types';
import { useI18n } from '../i18n';
import { useTheme } from '../contexts/ThemeContext';

const SchedulePanel: React.FC = () => {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const [mode, setMode] = useState<'algorithm' | 'llm'>('algorithm');
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const priorityLabels: Record<Priority, string> = {
    'urgent-important': t.priority.urgentImportant,
    'important': t.priority.important,
    'urgent': t.priority.urgent,
    'normal': t.priority.normal,
  };

  const handleGenerate = async () => {
    setLoading(true);
    setResult(null);
    try {
      const data = await scheduleApi.generate(mode);
      setResult(data);
    } catch (err: any) {
      const msg = err?.response?.data?.error || t.schedule.generateFailed;
      setResult({
        mode,
        schedule: [],
        validation: { valid: false, errors: [msg] },
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!result) return;
    setApplying(true);
    try {
      await scheduleApi.apply(result.schedule);
      message.success(t.schedule.applied);
      setResult(null);
    } catch {
      message.error(t.schedule.applyFailed);
    } finally {
      setApplying(false);
    }
  };

  const sortedSchedule = result
    ? [...result.schedule].sort((a, b) => a.start.localeCompare(b.start))
    : [];

  const renderScheduleItem = (item: typeof sortedSchedule[0], index: number) => {
    const duration = Math.round(
      (new Date(item.end).getTime() - new Date(item.start).getTime()) / 60000
    );
    return (
      <div
        key={index}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          marginBottom: 16,
          paddingLeft: 20,
          borderLeft: `3px solid ${PRIORITY_COLORS[item.priority as Priority]}`,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 'bold' }}>
            {item.title}
            <Tag color={PRIORITY_COLORS[item.priority as Priority]} style={{ marginLeft: 8 }}>
              {priorityLabels[item.priority as Priority]}
            </Tag>
          </div>
          <div style={{ fontSize: 12, color: isDark ? '#aaa' : '#666', marginTop: 4 }}>
            {dayjs(item.start).format('MM/DD HH:mm')} - {dayjs(item.end).format('HH:mm')}
            <span style={{ marginLeft: 8 }}>({duration} {t.schedule.minutes})</span>
          </div>
        </div>
      </div>
    );
  };

  const renderErrors = () => {
    if (!result || result.validation.errors.length === 0) return null;
    return (
      <Alert
        message={t.schedule.problems}
        description={
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {result.validation.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        }
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
      />
    );
  };

  return (
    <div style={{ background: isDark ? '#1f1f1f' : '#fff', padding: 24, borderRadius: 8 }}>
      <Card title={t.schedule.title} size="small" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <span>{t.schedule.mode}</span>
          <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
            <Radio.Button value="algorithm">
              <ThunderboltOutlined /> {t.schedule.algorithmSchedule}
            </Radio.Button>
            <Radio.Button value="llm">
              <RobotOutlined /> {t.schedule.llmSchedule}
            </Radio.Button>
          </Radio.Group>
          <Button type="primary" onClick={handleGenerate} loading={loading}>
            {t.schedule.generate}
          </Button>
        </div>

        {mode === 'llm' && (
          <Alert
            message={t.schedule.llmConfigRequired}
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
          />
        )}
      </Card>

      {loading && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" tip={t.schedule.generating}>
            <div />
          </Spin>
        </div>
      )}

      {result && !loading && (
        <>
          {renderErrors()}

          {sortedSchedule.length === 0 ? (
            <Empty description={t.schedule.noPending} />
          ) : (
            <>
              <Card
                title={`${t.schedule.schedulePlan} (${sortedSchedule.length} ${t.schedule.todos})`}
                size="small"
                style={{ marginBottom: 16 }}
              >
                {sortedSchedule.map((item, index) => renderScheduleItem(item, index))}
              </Card>

              <Button
                type="primary"
                size="large"
                block
                onClick={handleApply}
                loading={applying}
              >
                {t.schedule.applyPlan}
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default SchedulePanel;
