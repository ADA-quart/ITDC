import React, { useEffect, useRef, useState } from 'react';
import { Modal, Input, Select, DatePicker, Button, message, Space, Typography, Checkbox } from 'antd';
import { LoginOutlined, ImportOutlined } from '@ant-design/icons';
import { Dayjs } from 'dayjs';
import { Capacitor } from '@capacitor/core';
import { schoolApi, calendarApi } from '../api/client';
import { localSchoolApi } from '../api/school-cas';
import type { CdutCourse } from '../api/client';
import { expandWeeks } from '../../shared/cdut-parser';
import { useI18n } from '../i18n';
import { getCalendarCache } from '../api/offline';
import {
  clearSchoolCreds,
  getRememberEnabled,
  loadSchoolCreds,
  saveSchoolCreds,
  setRememberEnabled,
} from '../api/school-creds';

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

/** 聚合课程并展开周次为具体日期事件列表 */
function buildEvents(courses: CdutCourse[], weekStartDate: Date, schoolId: string) {
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
        source: schoolId,
      });
    }
  }
  return events;
}

const SchoolImportModal: React.FC<Props> = ({ open, onClose, onImported }) => {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const isNative = Capacitor.isNativePlatform();
  const [studentId, setStudentId] = useState('');
  const [semesters, setSemesters] = useState<string[]>([]);
  const [semester, setSemester] = useState<string>('');
  const [weekStart, setWeekStart] = useState<Dayjs | null>(null);
  const [schoolId, setSchoolId] = useState('cdut');
  const [loggingIn, setLoggingIn] = useState(false);
  const [importing, setImporting] = useState(false);
  const [remember, setRemember] = useState(getRememberEnabled());
  const autoLoginTriedRef = useRef(false);

  const reset = () => {
    setSessionId(null); setStudentId(''); setSemesters([]); setSemester('');
    setPassword(''); setWeekStart(null);
  };

  const handleLogin = async (userArg?: string, passArg?: string) => {
    const user = userArg ?? username;
    const pass = passArg ?? password;
    if (!user || !pass) { message.warning(t.schoolImport.studentIdRequired); return; }
    setLoggingIn(true);
    try {
      const r = isNative
        ? { sessionId: 'local', ...(await localSchoolApi.login(schoolId, user, pass)) }
        : await schoolApi.login(schoolId, user, pass);
      setSessionId(r.sessionId);
      setStudentId(r.studentId);
      setSemesters(r.semesters);
      if (r.semesters.length > 0) setSemester(r.semesters[r.semesters.length - 1]);
      // 登录成功后按开关保存/清除凭据
      if (remember) await saveSchoolCreds(schoolId, user, pass);
      else await clearSchoolCreds(schoolId);
      message.success(t.schoolImport.loginOk);
    } catch (err: any) {
      // 本机直连没有 HTTP 响应体，真实原因在 err.message 里（服务端模式才在 response 里）
      message.error(err?.response?.data?.error || err?.message || t.schoolImport.loginFail);
    } finally { setLoggingIn(false); }
  };

  // 打开弹窗：有记住的账号就直接自动登录，省得每次重输
  useEffect(() => {
    if (!open) { autoLoginTriedRef.current = false; return; }
    if (autoLoginTriedRef.current) return;
    autoLoginTriedRef.current = true;
    void (async () => {
      const creds = await loadSchoolCreds(schoolId);
      if (!creds) return;
      setUsername(creds.username);
      setPassword(creds.password);
      if (getRememberEnabled()) await handleLogin(creds.username, creds.password);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleImport = async () => {
    if (!sessionId || !semester || !weekStart) {
      message.warning(t.schoolImport.selectAllRequired);
      return;
    }
    setImporting(true);
    try {
      const r = isNative && sessionId === 'local'
        ? await localSchoolApi.timetable(schoolId, semester)
        : await schoolApi.timetable(sessionId, semester);
      if (r.courses.length === 0) { message.warning(t.schoolImport.noCourses); return; }
      const events = buildEvents(r.courses, weekStart.toDate(), schoolId);
      // 建日历
      const newCalendar = await calendarApi.create({
        name: `教务课表 ${semester}`,
        color: '#722ed1',
        source: schoolId,
      });
      // 获取新日历实际 id（服务器或本地）
      const after = await getCalendarCache();
      const newCal = after.find((c) => c.sync_uid === newCalendar.sync_uid) ?? newCalendar;
      for (const ev of events) {
        await calendarApi.createEvent({ ...ev, calendar_id: newCal.id, calendar_name: newCal.name, calendar_color: newCal.color });
      }
      message.success(t.schoolImport.imported.replaceAll('{count}', String(events.length)));
      onImported();
      reset();
      onClose();
    } catch (err: any) {
      message.error(err?.response?.data?.error || t.schoolImport.importFail);
    } finally { setImporting(false); }
  };

  return (
    <Modal
      title={t.schoolImport.title}
      open={open}
      onCancel={() => { reset(); onClose(); }}
      footer={sessionId ? [
        <Button key="cancel" onClick={() => { reset(); onClose(); }}>{t.schoolImport.cancel}</Button>,
        <Button key="import" type="primary" icon={<ImportOutlined />} loading={importing} onClick={handleImport}>
          {t.schoolImport.importBtn}
        </Button>,
      ] : [
        <Button key="cancel" onClick={onClose}>{t.schoolImport.cancel}</Button>,
        <Button key="login" type="primary" icon={<LoginOutlined />} loading={loggingIn} onClick={() => handleLogin()}>
          {t.schoolImport.loginBtn}
        </Button>,
      ]}
    >
      {!sessionId ? (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Typography.Text type="secondary">{t.schoolImport.desc}</Typography.Text>
          <Input
            placeholder={t.schoolImport.studentId}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Input.Password
            placeholder={t.schoolImport.password}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onPressEnter={() => handleLogin()}
          />
          <Checkbox
            checked={remember}
            onChange={(e) => {
              setRemember(e.target.checked);
              setRememberEnabled(e.target.checked);
            }}
          >
            {t.schoolImport.remember}
          </Checkbox>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t.schoolImport.rememberHint}
          </Typography.Text>
        </Space>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Typography.Text type="secondary">{t.schoolImport.loggedIn.replace('{id}', studentId)}</Typography.Text>
          <Select
            style={{ width: '100%' }}
            placeholder={t.schoolImport.selectSemester}
            value={semester || undefined}
            onChange={(v) => setSemester(v)}
            options={semesters.map((s) => ({ value: s, label: s }))}
          />
          <DatePicker
            style={{ width: '100%' }}
            placeholder={t.schoolImport.weekStartDate}
            value={weekStart}
            onChange={(d) => setWeekStart(d)}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t.schoolImport.weekStartHint}</Typography.Text>
        </Space>
      )}
    </Modal>
  );
};

export default SchoolImportModal;
