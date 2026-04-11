import React, { useState } from 'react';
import { Button, Card, Radio, Tag, Alert, Spin, Empty, message } from 'antd';
import { ThunderboltOutlined, RobotOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { scheduleApi } from '../api/client';
import type { ScheduleResult, Priority } from '../types';
import { PRIORITY_LABELS, PRIORITY_COLORS } from '../types';

const SchedulePanel: React.FC = () => {
  const [mode, setMode] = useState<'algorithm' | 'llm'>('algorithm');
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    setResult(null);
    try {
      const data = await scheduleApi.generate(mode);
      setResult(data);
    } catch (err: any) {
      const msg = err?.response?.data?.error || '生成方案失败';
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
      message.success('调度方案已应用');
      setResult(null);
    } catch {
      message.error('应用方案失败');
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
              {PRIORITY_LABELS[item.priority as Priority]}
            </Tag>
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
            {dayjs(item.start).format('MM/DD HH:mm')} - {dayjs(item.end).format('HH:mm')}
            <span style={{ marginLeft: 8 }}>({duration} 分钟)</span>
          </div>
        </div>
      </div>
    );
  };

  const renderErrors = () => {
    if (!result || result.validation.errors.length === 0) return null;
    return (
      <Alert
        message="方案存在以下问题"
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
    <div style={{ background: '#fff', padding: 24, borderRadius: 8 }}>
      <Card title="智能日程规划" size="small" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <span>调度模式：</span>
          <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
            <Radio.Button value="algorithm">
              <ThunderboltOutlined /> 算法调度
            </Radio.Button>
            <Radio.Button value="llm">
              <RobotOutlined /> LLM 调度
            </Radio.Button>
          </Radio.Group>
          <Button type="primary" onClick={handleGenerate} loading={loading}>
            生成方案
          </Button>
        </div>

        {mode === 'llm' && (
          <Alert
            message="LLM 调度需要在设置中先配置 LLM 服务"
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
          />
        )}
      </Card>

      {loading && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" tip="正在生成调度方案...">
            <div />
          </Spin>
        </div>
      )}

      {result && !loading && (
        <>
          {renderErrors()}

          {sortedSchedule.length === 0 ? (
            <Empty description="没有待安排的待办事件" />
          ) : (
            <>
              <Card
                title={`调度方案 (${sortedSchedule.length} 个待办)`}
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
                应用此方案
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default SchedulePanel;
