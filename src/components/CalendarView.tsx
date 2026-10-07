import React, { useEffect, useState, useRef, useCallback } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import rrulePlugin from '@fullcalendar/rrule';
import zhCnLocale from '@fullcalendar/core/locales/zh-cn';
import enLocale from '@fullcalendar/core/locales/en-gb';
import {
  Alert, Button, Modal, Form, Input, Select, DatePicker, message,
  Checkbox, Popconfirm, ColorPicker, Tooltip, Segmented,
} from 'antd';
import {
  PlusOutlined, UploadOutlined, DeleteOutlined,
  FolderAddOutlined, DownloadOutlined, ImportOutlined,
  LeftOutlined, RightOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { Capacitor } from '@capacitor/core';
import { calendarApi, todoApi, getApiBase } from '../api/client';
import type { Calendar, CalendarEvent, Todo } from '../types';
import { TODO_PALETTE } from '../types';
import ImportModal from './ImportModal';
import SchoolImportModal from './SchoolImportModal';
import { getSelectedSchool } from '../api/school-prefs';
import { syncClassReminders } from '../api/reminders';
import { useI18n } from '../i18n';
import { useTheme } from '../contexts/ThemeContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { swipeDirection } from '../utils/swipe';
import { cardStyle, TOUCH_TARGET } from './ui';

const CAL_VIEW_KEY = 'itdc_calendar_view';

/** 标题去掉当年的年份，手机上才放得下一行（如「2026年10月12日 - 18日」→「10月12日 - 18日」） */
function shortTitle(raw: string): string {
  const y = String(new Date().getFullYear());
  let out = raw;
  if (out.startsWith(`${y}年`)) out = out.slice(y.length + 1);
  if (out.endsWith(`, ${y}`)) out = out.slice(0, -`, ${y}`.length);
  if (out.endsWith(` ${y}`)) out = out.slice(0, -(` ${y}`).length);
  return out.trim();
}

/** 教室：解析结果是「教学楼 - 教室」，窄列里只显示教室 */
function shortRoom(location?: string | null): string {
  const raw = (location ?? '').trim();
  if (!raw) return '';
  const parts = raw.split(' - ');
  return parts[parts.length - 1].trim();
}

/** 记住上次用的日历视图：手机首次默认单日，桌面默认周视图 */
function resolveInitialView(isMobile: boolean): string {
  try {
    const saved = localStorage.getItem(CAL_VIEW_KEY);
    if (saved === 'timeGridDay' || saved === 'timeGridWeek' || saved === 'dayGridMonth') return saved;
  } catch { /* 读取失败用默认值 */ }
  return isMobile ? 'timeGridDay' : 'timeGridWeek';
}

const CalendarView: React.FC = () => {
  const { t, locale } = useI18n();
  const { isDark } = useTheme();
  const isMobile = useIsMobile();
  const [events, setEvents] = useState<any[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [hiddenCalendars, setHiddenCalendars] = useState<Set<number>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [cdutOpen, setCdutOpen] = useState(false);
  const [schoolEnabled, setSchoolEnabled] = useState(false);
  const [addCalOpen, setAddCalOpen] = useState(false);
  const [addCalForm] = Form.useForm();
  const [form] = Form.useForm();
  const [exporting, setExporting] = useState(false);
  const [exportingIcal, setExportingIcal] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const settingsPromptedRef = useRef(false);
  const calendarRef = useRef<FullCalendar>(null);
  const swipeRef = useRef<HTMLDivElement | null>(null);
  // 初始视图只取一次：之后由用户自己切换，viewDidMount 会把选择记下来
  const [calView] = useState(() => resolveInitialView(isMobile));
  const [calViewType, setCalViewType] = useState(calView);
  const [calTitle, setCalTitle] = useState('');

  const hiddenCalendarsRef = useRef<Set<number>>(hiddenCalendars);
  hiddenCalendarsRef.current = hiddenCalendars;
  const calendarsRef = useRef<Calendar[]>(calendars);
  calendarsRef.current = calendars;

  const getTodoColor = (todo: Todo, index: number): string => {
    if (todo.color) return todo.color;
    return TODO_PALETTE[todo.id % TODO_PALETTE.length];
  };

  const buildEvents = useCallback(async (evts?: CalendarEvent[], currentHidden?: Set<number>) => {
    const rawEvents = evts ?? await calendarApi.getEvents();
    // 接口异常时仍可能拿到非数组（HTML 回退页等），这里归一化，保证渲染不崩
    const eventList: CalendarEvent[] = Array.isArray(rawEvents) ? rawEvents : [];
    const hidden = currentHidden || hiddenCalendarsRef.current;
    const rawTodos = await todoApi.getAll({ status: 'scheduled' });
    const todoList: Todo[] = Array.isArray(rawTodos) ? rawTodos : [];
    // 事件颜色优先级：事件自己的颜色（课程配色）→ 服务器回传的日历色 → 本地日历色
    const colorByCalendarId = new Map(calendarsRef.current.map((c) => [c.id, c.color]));
    const fcEvents = eventList
      .filter((e: CalendarEvent) => !hidden.has(e.calendar_id))
      .map((e: CalendarEvent) => {
        const color = e.color || e.calendar_color || colorByCalendarId.get(e.calendar_id) || '#1890ff';
        return {
          id: String(e.id),
          title: e.title,
          start: e.start_time,
          end: e.end_time,
          rrule: e.rrule || undefined,
          backgroundColor: color,
          borderColor: color,
          extendedProps: { ...e },
        };
      });
    const todoEvents = todoList
      .filter(todo => todo.scheduled_start && todo.scheduled_end)
      .map((todo, idx) => {
        const color = getTodoColor(todo, idx);
        return {
          id: 'todo-' + todo.id,
          title: t.calendar.todoPrefix + todo.title,
          start: todo.scheduled_start as string,
          end: todo.scheduled_end as string,
          backgroundColor: color,
          borderColor: color,
          extendedProps: { type: 'todo', ...todo },
        };
      });
    setEvents([...fcEvents, ...todoEvents]);
  }, [t]);

  const calInitRef = useRef({ done: false });

  const loadData = useCallback(async () => {
    try {
      const [cals, evts] = await Promise.all([
        calendarApi.getAll(),
        calendarApi.getEvents(),
      ]);
      setLoadError(null);
      setCalendars(cals);
      if (cals.length === 0 && !calInitRef.current.done) {
        calInitRef.current.done = true;
        await calendarApi.create({ name: t.calendar.defaultCalendarName, color: '#1890ff' });
        const newCals = await calendarApi.getAll();
        setCalendars(newCals);
      }
      buildEvents(evts, hiddenCalendarsRef.current);
      // 上课提醒排程：按最新课表事件重排（Android 端本地通知，不依赖服务器）
      void syncClassReminders(Array.isArray(evts) ? evts : []);
    } catch (err) {
      console.warn('日历数据加载失败:', err);
      message.error(t.calendar.dataLoadFailed);
      const base = getApiBase();
      const hint = Capacitor.isNativePlatform() ? t.calendar.dataLoadFailedNative : t.calendar.dataLoadFailedDesktop;
      setLoadError(base ? `${hint}（${t.calendar.currentServer}: ${base}）` : hint);
    }
  }, [buildEvents]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    getSelectedSchool().then((id) => setSchoolEnabled(!!id)).catch(() => {});
    const handler = () => getSelectedSchool().then((id) => setSchoolEnabled(!!id)).catch(() => {});
    window.addEventListener('school-prefs-changed', handler);
    return () => window.removeEventListener('school-prefs-changed', handler);
  }, []);

  useEffect(() => {
    // 隐藏日历变化时局部刷新；失败只影响刷新，不能冒泡成未处理拒绝导致白屏
    buildEvents(undefined, hiddenCalendars).catch((err) => console.warn('日历事件刷新失败:', err));
  }, [hiddenCalendars, buildEvents]);

  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('todo-data-changed', handler);
    return () => window.removeEventListener('todo-data-changed', handler);
  }, [loadData]);

  // 手机上左右滑动翻页：日视图滑一天、周视图滑一周，省得反复点箭头
  useEffect(() => {
    const el = swipeRef.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let tracking = false;
    const onStart = (e: TouchEvent) => {
      tracking = e.touches.length === 1;
      if (!tracking) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const dir = swipeDirection(dx, dy);
      if (!dir) return;
      const api = calendarRef.current?.getApi();
      if (!api) return;
      if (dir === 'next') api.next(); else api.prev();
    };
    // 捕获阶段 + passive：既能在 FullCalendar 内部处理前拿到手势，也不影响它自己的滚动
    el.addEventListener('touchstart', onStart, { capture: true, passive: true });
    el.addEventListener('touchend', onEnd, { capture: true, passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart, true);
      el.removeEventListener('touchend', onEnd, true);
    };
  }, []);

  const handleDateSelect = (selectInfo: any) => {
    form.setFieldsValue({
      start_time: dayjs(selectInfo.startStr),
      end_time: dayjs(selectInfo.endStr),
      calendar_id: calendars.length > 0 ? calendars[0].id : undefined,
    });
    setModalOpen(true);
  };

  const handleEventClick = (clickInfo: any) => {
    const props = clickInfo.event.extendedProps;
    if (props.type === 'todo') return;
    Modal.confirm({
      title: t.calendar.deleteEvent,
      content: t.calendar.confirmDelete + ' "' + clickInfo.event.title + '" ?',
      okText: t.calendar.delete,
      cancelText: t.calendar.cancel,
      onOk: async () => {
        await calendarApi.deleteEvent(Number(clickInfo.event.id));
        loadData();
        message.success(t.calendar.delete);
      },
    });
  };

  const handleEventDrop = async (dropInfo: any) => {
    const props = dropInfo.event.extendedProps;
    if (props.type === 'todo') {
      try {
        await todoApi.update(props.id, {
          scheduled_start: dropInfo.event.startStr,
          scheduled_end: dropInfo.event.endStr,
        });
        message.success(t.calendar.eventMoved);
      } catch {
        message.error(t.calendar.eventMoveFailed);
        dropInfo.revert();
      }
      return;
    }
    try {
      await calendarApi.updateEvent(Number(dropInfo.event.id), {
        start_time: dropInfo.event.startStr,
        end_time: dropInfo.event.endStr,
      });
      message.success(t.calendar.eventMoved);
    } catch {
      message.error(t.calendar.eventMoveFailed);
      dropInfo.revert();
    }
  };

  const handleEventResize = async (resizeInfo: any) => {
    const props = resizeInfo.event.extendedProps;
    if (props.type === 'todo') {
      try {
        await todoApi.update(props.id, {
          scheduled_start: resizeInfo.event.startStr,
          scheduled_end: resizeInfo.event.endStr,
        });
        message.success(t.calendar.eventResized);
      } catch {
        message.error(t.calendar.eventResizeFailed);
        resizeInfo.revert();
      }
      return;
    }
    try {
      await calendarApi.updateEvent(Number(resizeInfo.event.id), {
        start_time: resizeInfo.event.startStr,
        end_time: resizeInfo.event.endStr,
      });
      message.success(t.calendar.eventResized);
    } catch {
      message.error(t.calendar.eventResizeFailed);
      resizeInfo.revert();
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const data = {
        calendar_id: values.calendar_id,
        title: values.title,
        description: values.description,
        start_time: values.start_time.toISOString(),
        end_time: values.end_time.toISOString(),
        location: values.location,
      };
      await calendarApi.createEvent(data);
      message.success(t.calendar.eventCreated);
      setModalOpen(false);
      form.resetFields();
      loadData();
    } catch { /* validation */ }
  };

  const handleAddCalendar = async () => {
    try {
      const values = await addCalForm.validateFields();
      const colorStr = typeof values.color === 'string'
        ? values.color
        : (values.color?.toHexString?.() || '#1890ff');
      await calendarApi.create({ name: values.name, color: colorStr });
      message.success(t.calendar.calendarCreated);
      setAddCalOpen(false);
      addCalForm.resetFields();
      loadData();
    } catch { /* validation */ }
  };

  const handleDeleteCalendar = async (id: number) => {
    try {
      await calendarApi.delete(id);
      message.success(t.calendar.calendarDeleted);
      loadData();
    } catch {
      message.error(t.calendar.calendarDeleteFailed);
    }
  };

  const toggleCalendar = (id: number) => {
    const next = new Set(hiddenCalendars);
    if (next.has(id)) { next.delete(id); } else { next.add(id); }
    setHiddenCalendars(next);
  };

  const handleExportWeek = async () => {
    try {
      setExporting(true);
      await calendarApi.exportWeek(locale);
      message.success(t.calendar.weekExported);
    } catch {
      message.error(t.calendar.exportFailed);
    } finally {
      setExporting(false);
    }
  };

  const handleExportIcal = async () => {
    try {
      setExportingIcal(true);
      await calendarApi.exportIcal(locale);
      message.success(t.calendar.icalExported);
    } catch {
      message.error(t.calendar.exportFailed);
    } finally {
      setExportingIcal(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: isMobile ? undefined : 'calc(100vh - 48px)',
      gap: 12,
      minHeight: 0,
    }}>
      {loadError && (
        <Alert
          type="error"
          showIcon
          message={t.calendar.dataLoadFailed}
          description={loadError}
          action={
            <Button size="small" onClick={() => window.dispatchEvent(new CustomEvent('itdc-open-settings'))}>
              {t.calendar.gotoSettings}
            </Button>
          }
          closable
          onClose={() => setLoadError(null)}
        />
      )}
      {/* 窄屏改为上下堆叠：日历优先占满，日历列表与导入导出折叠到下方 */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', flex: isMobile ? undefined : 1, gap: 12, minHeight: 0 }}>
      <div style={{
        width: isMobile ? '100%' : 220,
        minWidth: isMobile ? undefined : 220,
        ...cardStyle(isDark, isMobile, { padding: isMobile ? 12 : 16 }),
        display: 'flex',
        flexDirection: 'column',
        order: isMobile ? 2 : 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontWeight: 'bold' }}>{t.calendar.calendarList}</span>
          <Tooltip title={t.calendar.newCalendar}>
            <Button size="small" type="text" icon={<FolderAddOutlined />} onClick={() => setAddCalOpen(true)} />
          </Tooltip>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {calendars.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: TOUCH_TARGET, padding: '8px 10px', borderRadius: 10, marginBottom: 6, background: hiddenCalendars.has(c.id) ? (isDark ? '#303030' : '#f5f5f5') : (isDark ? '#1a1a2e' : '#e6f7ff'), opacity: hiddenCalendars.has(c.id) ? 0.5 : 1 }}>
              <Checkbox checked={!hiddenCalendars.has(c.id)} onChange={() => toggleCalendar(c.id)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
              </Checkbox>
              {calendars.length <= 1 ? null : (
                <Popconfirm title={t.calendar.deleteCalendar} onConfirm={() => handleDeleteCalendar(c.id)} okText={t.calendar.delete} cancelText={t.calendar.cancel}>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              )}
            </div>
          ))}
        </div>
        <div style={{ borderTop: `1px solid ${isDark ? '#303030' : '#f0f0f0'}`, paddingTop: 12, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {schoolEnabled && (
            <Button icon={<ImportOutlined />} block onClick={() => setCdutOpen(true)}>{t.calendar.schoolImport}</Button>
          )}
          <Button icon={<DownloadOutlined />} block onClick={() => setImportOpen(true)}>{t.calendar.importIcal}</Button>
          <Button icon={<UploadOutlined />} block loading={exportingIcal} onClick={handleExportIcal}>{t.calendar.exportIcal}</Button>
          <Button icon={<UploadOutlined />} block loading={exporting} onClick={handleExportWeek}>{t.calendar.exportWeek}</Button>
        </div>
      </div>

      <div style={{
        flex: isMobile ? undefined : 1,
        ...cardStyle(isDark, isMobile, { padding: isMobile ? 12 : 16 }),
        overflow: 'auto',
        order: isMobile ? 1 : 0,
        minHeight: 0,
      }}>
        <div style={{ marginBottom: 12 }}>
          <Button type="primary" icon={<PlusOutlined />} block={isMobile} onClick={() => { form.resetFields(); form.setFieldsValue({ calendar_id: calendars.length > 0 ? calendars[0].id : undefined }); setModalOpen(true); }}>{t.calendar.newEvent}</Button>
        </div>
        {/* 手机端自绘导航：标题一行放得下，按钮分组不再挤成一团 */}
        {isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
            <Button
              size="small"
              type="text"
              aria-label={t.calendar.prevPage}
              icon={<LeftOutlined />}
              onClick={() => calendarRef.current?.getApi().prev()}
            />
            <div style={{
              flex: 1,
              minWidth: 0,
              textAlign: 'center',
              fontWeight: 600,
              fontSize: 15,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {calTitle}
            </div>
            <Button
              size="small"
              type="text"
              aria-label={t.calendar.nextPage}
              icon={<RightOutlined />}
              onClick={() => calendarRef.current?.getApi().next()}
            />
            <Button size="small" onClick={() => calendarRef.current?.getApi().today()}>{t.calendar.today}</Button>
            <Segmented
              size="small"
              value={calViewType}
              onChange={(v) => calendarRef.current?.getApi().changeView(String(v))}
              options={[
                { label: t.calendar.viewDay, value: 'timeGridDay' },
                { label: t.calendar.viewWeek, value: 'timeGridWeek' },
              ]}
            />
          </div>
        )}
        {/* 滑动容器：手机上左右滑即可翻到上一天/下一天（周视图则翻一周） */}
        <div
          ref={swipeRef}
          style={{
            // 今日底色调淡（默认是 rgba(255,220,40,.15) 的整列黄底）
            ['--fc-today-bg-color' as any]: 'rgba(24,144,255,0.05)',
          } as React.CSSProperties}
        >
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, rrulePlugin]}
            initialView={calView}
            locale={locale === 'zh' ? zhCnLocale : enLocale}
            headerToolbar={isMobile
              ? false
              : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
            datesSet={(arg) => {
              setCalTitle(shortTitle(arg.view.title));
              setCalViewType(arg.view.type);
              // 记住用户选的视图，下次打开沿用
              try { localStorage.setItem(CAL_VIEW_KEY, arg.view.type); } catch { /* 忽略存储失败 */ }
            }}
            eventContent={(arg) => {
              // 手机端周视图列很窄：只显示课名 + 教室（时间左边刻度已经有了）
              // 其它视图必须返回 true 才是「用默认渲染」——返回 undefined 会被当成
              // 自定义内容为空，事件块就只剩一个色块、文字全没了
              if (!isMobile || arg.view.type !== 'timeGridWeek') return true;
              const room = shortRoom((arg.event.extendedProps as any)?.location);
              return (
                <div style={{ lineHeight: 1.15, overflow: 'hidden', padding: '1px 2px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, wordBreak: 'break-word' }}>{arg.event.title}</div>
                  {room && <div style={{ fontSize: 10, opacity: 0.85, marginTop: 2 }}>{room}</div>}
                </div>
              );
            }}
            events={events}
            selectable
            editable
            select={handleDateSelect}
            eventClick={handleEventClick}
            eventDrop={handleEventDrop}
            eventResize={handleEventResize}
            height={isMobile ? 520 : 'auto'}
            allDaySlot={true}
            slotMinTime="07:00:00"
            slotMaxTime="23:00:00"
          />
        </div>
      </div>
      </div>

      <Modal title={t.calendar.newEvent} open={modalOpen} onOk={handleSubmit} onCancel={() => { setModalOpen(false); form.resetFields(); }} okText={t.calendar.createEvent} cancelText={t.calendar.cancel}>
        <Form form={form} layout="vertical">
          <Form.Item name="title" label={t.calendar.title} rules={[{ required: true, message: t.calendar.enterTitle }]}><Input placeholder={t.calendar.eventTitle} /></Form.Item>
          <Form.Item name="calendar_id" label={t.calendar.calendar} rules={[{ required: true, message: t.calendar.selectCalendarPrompt }]}>
            <Select placeholder={t.calendar.selectCalendar}>{calendars.map(c => (<Select.Option key={c.id} value={c.id}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: c.color, marginRight: 8 }} />{c.name}</Select.Option>))}</Select>
          </Form.Item>
          <Form.Item name="start_time" label={t.calendar.startTime} rules={[{ required: true, message: t.calendar.selectStartTime }]}><DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="end_time" label={t.calendar.endTime} rules={[{ required: true, message: t.calendar.selectEndTime }]}><DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="description" label={t.calendar.description}><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="location" label={t.calendar.location}><Input placeholder={t.calendar.eventLocation} /></Form.Item>
        </Form>
      </Modal>

      <Modal title={t.calendar.newCalendar} open={addCalOpen} onOk={handleAddCalendar} onCancel={() => { setAddCalOpen(false); addCalForm.resetFields(); }} okText={t.calendar.createCalendar} cancelText={t.calendar.cancel}>
        <Form form={addCalForm} layout="vertical" initialValues={{ color: "#52c41a" }}>
          <Form.Item name="name" label={t.calendar.calendarName} rules={[{ required: true, message: t.calendar.calendarName }]}><Input placeholder="Work, Study..." /></Form.Item>
          <Form.Item name="color" label={t.calendar.color}><ColorPicker /></Form.Item>
        </Form>
      </Modal>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={loadData} />
      <SchoolImportModal open={cdutOpen} onClose={() => setCdutOpen(false)} onImported={loadData} />
    </div>
  );
};

export default CalendarView;
