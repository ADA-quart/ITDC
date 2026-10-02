import React, { useState } from 'react';
import { Modal, Input, Select, DatePicker, Button, message, Space, Typography } from 'antd';
import { LoginOutlined, ImportOutlined } from '@ant-design/icons';
import { Dayjs } from 'dayjs';
import { cdutApi, calendarApi } from '../api/client';
import type { CdutCourse } from '../api/client';
import { useI18n } from '../i18n';
import { getCalendarCache } from '../api/offline';

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

/** CDUT 节次时间表（与 CDUniTap 硬编码一致） */
const TIMETABLE: readonly [string, string][] = [
  ['08:10', '09:45'],
  ['10:15', '11:50'],
  ['13:00', '14:00'],
  ['14:30', '16:05'],
  ['16:25', '18:00'],
  ['19:10', '20:45'],
];

/** 展开 "1-16" 或 "1-8,10-16" 或 "1,3,5" 为数字数组 */
function expandWeeks(raw: string): number[] {
  const out: number[] = [];
  if (!raw) return out;
  for (const seg of raw.replace(/周\s*$/, '').split(/[,，]/)) {
    const m = /^(\d+)-(\d+)$/.exec(seg.trim());
    if (m) {
      for (let i = parseInt(m[1], 10); i <= parseInt(m[2], 10); i++) out.push(i);
    } else {
      const n = parseInt(seg.trim(), 10);
      if (!isNaN(n)) out.push(n);
    }
  }
  return out;
}

/** 聚合课程并展开周次为具体日期事件列表 */
function buildEvents(courses: CdutCourse[], weekStartDate: Date) {
  interface AggKey { name: string; teacher: string; location: string; sectionIndex: number; dayOfWeek: number; sections: string; }
  const aggMap = new Map<string, { key: AggKey; weeks: Set<number> }>();
  for (const c of courses) {
    const aggKey = `${c.name}|${c.teacher}|${c.location}|${c.sectionIndex}|${c.dayOfWeek}`;
    if (!aggMap.has(aggKey)) {
      aggMap.set(aggKey, {
        key: { name: c.name, teacher: c.teacher, location: c.location, sectionIndex: c.sectionIndex, dayOfWeek: c.dayOfWeek, sections: c.sections },
        weeks: new Set(),
      });
    }
    for (const n of expandWeeks(c.weeks)) aggMap.get(aggKey)!.weeks.add(n);
  }

  const events: Array<{
    title: string;
    description: string | null;
    start_time: string;
    end_time: string;
    location: string | null;
    source: string;
  }> = [];

  for (const { key, weeks } of aggMap.values()) {
    const [sh, sm] = TIMETABLE[key.sectionIndex][0].split(':').map(Number);
    const [eh, em] = TIMETABLE[key.sectionIndex][1].split(':').map(Number);
    const sortedWeeks = [...weeks].sort((a, b) => a - b);
    const weekLabel = `第${sortedWeeks.join(',')}周`;
    for (const w of sortedWeeks) {
      const date = new Date(weekStartDate);
      date.setDate(date.getDate() + (w - 1) * 7 + (key.dayOfWeek - 1));
      const start = new Date(date);
      start.setHours(sh, sm, 0, 0);
      const end = new Date(date);
      end.setHours(eh, em, 0, 0);
      events.push({
        title: key.name,
        description: [key.teacher, weekLabel, key.sections].filter(Boolean).join('\n') || null,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        location: key.location || null,
        source: 'cdut',
      });
    }
  }
  return events;
}

const CdutImportModal: React.FC<Props> = ({ open, onClose, onImported }) => {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [studentId, setStudentId] = useState('');
  const [semesters, setSemesters] = useState<string[]>([]);
  const [semester, setSemester] = useState<string>('');
  const [weekStart, setWeekStart] = useState<Dayjs | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [importing, setImporting] = useState(false);

  const reset = () => {
    setSessionId(null); setStudentId(''); setSemesters([]); setSemester('');
    setPassword(''); setWeekStart(null);
  };

  const handleLogin = async () => {
    if (!username || !password) { message.warning(t.cdut.studentIdRequired); return; }
    setLoggingIn(true);
    try {
      const r = await cdutApi.login(username, password);
      setSessionId(r.sessionId);
      setStudentId(r.studentId);
      setSemesters(r.semesters);
      if (r.semesters.length > 0) setSemester(r.semesters[r.semesters.length - 1]);
      message.success(t.cdut.loginOk);
    } catch (err: any) {
      message.error(err?.response?.data?.error || t.cdut.loginFail);
    } finally { setLoggingIn(false); }
  };

  const handleImport = async () => {
    if (!sessionId || !semester || !weekStart) {
      message.warning(t.cdut.selectAllRequired);
      return;
    }
    setImporting(true);
    try {
      const r = await cdutApi.timetable(sessionId, semester);
      if (r.courses.length === 0) { message.warning(t.cdut.noCourses); return; }
      const events = buildEvents(r.courses, weekStart.toDate());
      // 建日历
      const newCalendar = await calendarApi.create({
        name: `教务课表 ${semester}`,
        color: '#722ed1',
        source: 'cdut',
      });
      // 获取新日历实际 id（服务器或本地）
      const after = await getCalendarCache();
      const newCal = after.find((c) => c.sync_uid === newCalendar.sync_uid) ?? newCalendar;
      for (const ev of events) {
        await calendarApi.createEvent({ ...ev, calendar_id: newCal.id, calendar_name: newCal.name, calendar_color: newCal.color });
      }
      message.success(t.cdut.imported.replaceAll('{count}', String(events.length)));
      onImported();
      reset();
      onClose();
    } catch (err: any) {
      message.error(err?.response?.data?.error || t.cdut.importFail);
    } finally { setImporting(false); }
  };

  return (
    <Modal
      title={t.cdut.title}
      open={open}
      onCancel={() => { reset(); onClose(); }}
      footer={sessionId ? [
        <Button key="cancel" onClick={() => { reset(); onClose(); }}>{t.cdut.cancel}</Button>,
        <Button key="import" type="primary" icon={<ImportOutlined />} loading={importing} onClick={handleImport}>
          {t.cdut.importBtn}
        </Button>,
      ] : [
        <Button key="cancel" onClick={onClose}>{t.cdut.cancel}</Button>,
        <Button key="login" type="primary" icon={<LoginOutlined />} loading={loggingIn} onClick={handleLogin}>
          {t.cdut.loginBtn}
        </Button>,
      ]}
    >
      {!sessionId ? (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Typography.Text type="secondary">{t.cdut.desc}</Typography.Text>
          <Input
            placeholder={t.cdut.studentId}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Input.Password
            placeholder={t.cdut.password}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onPressEnter={handleLogin}
          />
        </Space>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Typography.Text type="secondary">{t.cdut.loggedIn.replace('{id}', studentId)}</Typography.Text>
          <Select
            style={{ width: '100%' }}
            placeholder={t.cdut.selectSemester}
            value={semester || undefined}
            onChange={(v) => setSemester(v)}
            options={semesters.map((s) => ({ value: s, label: s }))}
          />
          <DatePicker
            style={{ width: '100%' }}
            placeholder={t.cdut.weekStartDate}
            value={weekStart}
            onChange={(d) => setWeekStart(d)}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t.cdut.weekStartHint}</Typography.Text>
        </Space>
      )}
    </Modal>
  );
};

export default CdutImportModal;
