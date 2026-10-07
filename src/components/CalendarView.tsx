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
import { findMergeTarget } from '../utils/calendar-merge';
import { cardStyle, hintTextStyle, secondaryTextColor, TOUCH_TARGET, TYPE } from './ui';

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
  const [detailEvent, setDetailEvent] = useState<any | null>(null);
  const longPressFiredRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  // 事件 id → DOM 元素，融合动画需要知道"融进哪一滴"的位置
  const eventElsRef = useRef<Map<string, HTMLElement>>(new Map());

  /**
   * 水滴融合动画：待办缩成一个圆点滑进课程中心，课程像水面一样弹一下，并荡开一圈涟漪。
   * 用 Web Animations API 直接跑，不引入样式文件。
   */
  const playMergeAnimation = (fromEl?: HTMLElement | null, toEl?: HTMLElement | null) => {
    if (!fromEl || !toEl || typeof fromEl.animate !== 'function') return;
    const from = fromEl.getBoundingClientRect();
    const to = toEl.getBoundingClientRect();
    if (!from.width || !to.width) return;
    const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
    const dy = (to.top + to.height / 2) - (from.top + from.height / 2);

    fromEl.animate(
      [
        { transform: 'translate(0,0) scale(1)', borderRadius: '6px', opacity: 1 },
        { transform: `translate(${dx * 0.55}px, ${dy * 0.55}px) scale(0.55)`, borderRadius: '45%', opacity: 0.9, offset: 0.72 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.15)`, borderRadius: '50%', opacity: 0 },
      ],
      { duration: 430, easing: 'cubic-bezier(.34,1.26,.64,1)', fill: 'forwards' }
    );
    toEl.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.06)', offset: 0.4 },
        { transform: 'scale(1)' },
      ],
      { duration: 520, easing: 'cubic-bezier(.34,1.56,.64,1)' }
    );

    const ripple = document.createElement('div');
    ripple.style.cssText = `position:fixed;left:${to.left}px;top:${to.top}px;width:${to.width}px;height:${to.height}px;`
      + 'border-radius:8px;border:2px solid rgba(255,255,255,.85);pointer-events:none;z-index:9999;';
    document.body.appendChild(ripple);
    ripple.animate(
      [{ transform: 'scale(1)', opacity: 0.75 }, { transform: 'scale(1.35)', opacity: 0 }],
      { duration: 520, easing: 'ease-out' }
    ).finished.finally(() => ripple.remove());
  };

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

    // 「拖进去就融成一滴」：整段落在课程/日程里的待办不再单独占一格，
    // 改挂到那个事件上（角标显示数量，点开详情能看到具体要做什么）
    const mergedByEventId = new Map<string, typeof todoEvents>();
    const standaloneTodos: typeof todoEvents = [];
    for (const todoEvent of todoEvents) {
      const target = findMergeTarget({ start: todoEvent.start, end: todoEvent.end }, fcEvents);
      if (!target) {
        standaloneTodos.push(todoEvent);
        continue;
      }
      const list = mergedByEventId.get(target.id) ?? [];
      list.push(todoEvent);
      mergedByEventId.set(target.id, list);
    }
    const mergedEvents = fcEvents.map((e) => {
      const merged = mergedByEventId.get(e.id);
      if (!merged || merged.length === 0) return e;
      return {
        ...e,
        extendedProps: {
          ...e.extendedProps,
          mergedTodos: merged.map((m) => ({
            id: m.extendedProps.id as number,
            title: String(m.title).replace(t.calendar.todoPrefix, ''),
            start: m.start,
            end: m.end,
            color: m.backgroundColor,
          })),
        },
      };
    });
    setEvents([...mergedEvents, ...standaloneTodos]);
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

  // 卸载时清掉长按计时器，避免页面切走后仍然弹出删除确认
  useEffect(() => () => {
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
  }, []);

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

  // 点一下＝看详情（周视图里格子太小，内容只有点开才看得全）；
  // 删除挪到长按，避免误触把课删掉
  const confirmDeleteEvent = (eventId: string, title: string) => {
    Modal.confirm({
      title: t.calendar.deleteEvent,
      content: `${t.calendar.confirmDelete} "${title}" ?`,
      okText: t.calendar.delete,
      cancelText: t.calendar.cancel,
      onOk: async () => {
        await calendarApi.deleteEvent(Number(eventId));
        setDetailEvent(null);
        loadData();
        message.success(t.calendar.delete);
      },
    });
  };

  const handleEventClick = (clickInfo: any) => {
    // 长按刚触发过删除，就别再弹详情
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    setDetailEvent(clickInfo.event);
  };

  /** 把待办从课程里移出来：清掉排期并回到待办列表（再拖进去就再融合） */
  const handleUnmerge = async (todoId: number) => {
    try {
      await todoApi.update(todoId, { scheduled_start: null, scheduled_end: null, status: 'pending' });
      message.success(t.calendar.unlinked);
      setDetailEvent(null);
      await loadData();
    } catch {
      message.error(t.calendar.eventMoveFailed);
    }
  };

  const handleEventDrop = async (dropInfo: any) => {
    const props = dropInfo.event.extendedProps;
    if (props.type === 'todo') {
      const startStr = dropInfo.event.startStr;
      const endStr = dropInfo.event.endStr;
      // 整段落进某节课/某个日程里 → 融合成一滴，不再单独占一格
      const target = findMergeTarget(
        { start: startStr, end: endStr },
        (events as any[]).filter((e) => e.extendedProps?.type !== 'todo')
      );
      try {
        await todoApi.update(props.id, {
          scheduled_start: startStr,
          scheduled_end: endStr,
        });
        if (target) {
          playMergeAnimation(dropInfo.el, eventElsRef.current.get(String(target.id)));
          message.success(t.calendar.mergedInto.replace('{name}', String(target.title)));
          // 等融合动画放完再重排，动画不会被打断
          window.setTimeout(() => { void loadData(); }, 430);
        } else {
          message.success(t.calendar.eventMoved);
          await loadData();
        }
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
                  {/* 字号下限对齐 Apple HIG 的 11pt / Material 的 label small */}
                  <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.25, wordBreak: 'break-word' }}>{arg.event.title}</div>
                  {room && <div style={{ fontSize: 11, lineHeight: 1.2, opacity: 0.9, marginTop: 1 }}>{room}</div>}
                </div>
              );
            }}
            events={events}
            selectable
            editable
            select={handleDateSelect}
            eventClick={handleEventClick}
            eventDidMount={(info) => {
              eventElsRef.current.set(String(info.event.id), info.el as HTMLElement);
              // 融合了待办的课程挂一个小角标，显示里面有几个待办
              const mergedCount = ((info.event.extendedProps?.mergedTodos as unknown[] | undefined) ?? []).length;
              if (mergedCount > 0) {
                const badge = document.createElement('span');
                badge.textContent = `${mergedCount}`;
                badge.title = t.calendar.mergedBadge.replace('{n}', String(mergedCount));
                badge.style.cssText = 'position:absolute;right:2px;bottom:1px;font-size:10px;line-height:1;'
                  + 'padding:1px 4px;border-radius:6px;background:rgba(255,255,255,.9);color:#333;pointer-events:none;';
                (info.el as HTMLElement).appendChild(badge);
              }
              // 待办用虚线的次要样式，和课程/日程区分开（拖进课程时段也不会抢视线）
              if (info.event.extendedProps?.type === 'todo') {
                const el = info.el as HTMLElement;
                el.style.borderStyle = 'dashed';
                el.style.borderWidth = '1px';
              }
              // 长按删除：触摸与鼠标都支持，点按（<600ms）不触发
              if (info.event.extendedProps?.type === 'todo') return;
              const el = info.el as HTMLElement;
              const clear = () => {
                if (longPressTimerRef.current !== null) {
                  window.clearTimeout(longPressTimerRef.current);
                  longPressTimerRef.current = null;
                }
              };
              const start = () => {
                clear();
                longPressFiredRef.current = false;
                longPressTimerRef.current = window.setTimeout(() => {
                  longPressTimerRef.current = null;
                  longPressFiredRef.current = true;
                  confirmDeleteEvent(String(info.event.id), info.event.title);
                }, 700);
              };
              el.addEventListener('touchstart', start, { passive: true });
              el.addEventListener('touchend', clear);
              el.addEventListener('touchmove', clear);
              el.addEventListener('touchcancel', clear);
              el.addEventListener('mousedown', start);
              el.addEventListener('mouseup', clear);
              el.addEventListener('mouseleave', clear);
            }}
            eventDrop={handleEventDrop}
            eventResize={handleEventResize}
            eventDragStart={() => {
              // 开始拖拽就取消长按删除（FullCalendar 在触屏上也是"按住再拖"）
              if (longPressTimerRef.current !== null) {
                window.clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
              }
            }}
            height={isMobile ? 520 : 'auto'}
            allDaySlot={true}
            // 待办拖进课程时段时并排显示，而不是盖住课程（课程优先，待办不占课的位置）
            slotEventOverlap={false}
            slotMinTime="07:00:00"
            slotMaxTime="23:00:00"
          />
        </div>
      </div>
      </div>

      {/* 事件 / 待办详情：点一下日历里的条目打开 */}
      <Modal
        open={!!detailEvent}
        title={detailEvent?.extendedProps?.type === 'todo' ? t.calendar.todoDetailTitle : t.calendar.detailTitle}
        onCancel={() => setDetailEvent(null)}
        footer={[
          detailEvent?.extendedProps?.type === 'todo' ? null : (
            <Button
              key="delete"
              danger
              onClick={() => confirmDeleteEvent(String(detailEvent.id), detailEvent.title)}
            >
              {t.calendar.delete}
            </Button>
          ),
          <Button key="close" type="primary" onClick={() => setDetailEvent(null)}>{t.calendar.close}</Button>,
        ].filter(Boolean)}
      >
        {detailEvent && (() => {
          const p = detailEvent.extendedProps || {};
          const isTodo = p.type === 'todo';
          const todoStatus = p.status === 'done' ? t.todo.done : p.status === 'scheduled' ? t.todo.scheduled : t.todo.pending;
          const rows: Array<[string, React.ReactNode]> = isTodo
            ? [
                [t.calendar.detailStatus, todoStatus],
                [t.calendar.detailEstimate, p.estimated_minutes ? `${p.estimated_minutes} ${t.todo.minutes}` : '-'],
                [t.calendar.detailScheduled, p.scheduled_start && p.scheduled_end
                  ? `${dayjs(p.scheduled_start).format('MM/DD HH:mm')} - ${dayjs(p.scheduled_end).format('HH:mm')}`
                  : '-'],
                [t.calendar.detailDeadline, p.deadline ? dayjs(p.deadline).format('YYYY-MM-DD HH:mm') : '-'],
                [t.calendar.detailNotes, p.description || '-'],
              ]
            : [
                [t.calendar.detailTime, `${dayjs(detailEvent.start).format('YYYY-MM-DD HH:mm')} - ${dayjs(detailEvent.end).format('HH:mm')}`],
                [t.calendar.detailLocation, p.location || '-'],
                [t.calendar.detailCalendar, p.calendar_name || calendarsRef.current.find((c) => c.id === p.calendar_id)?.name || '-'],
                [t.calendar.detailNotes, (p.description || '').split('\n').filter(Boolean).join(' · ') || '-'],
              ];
          // 融合进这段时间的待办：拖进来之后点开课程就能看到该做什么
          const blockTodos: Array<{ id: number; title: string; start: string; end: string; color: string }> =
            isTodo ? [] : ((p.mergedTodos as any[]) ?? []);
          return (
            <div>
              <div style={{ ...TYPE.bodyLarge, fontWeight: 600, marginBottom: 12 }}>{detailEvent.title}</div>
              {rows.map(([label, value]) => (
                <div key={label} style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'flex-start' }}>
                  <span style={{ color: secondaryTextColor(isDark), minWidth: 48 }}>{label}</span>
                  <span style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{value}</span>
                </div>
              ))}
              {!isTodo && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ ...TYPE.section, marginBottom: 6 }}>{t.calendar.classTodos}</div>
                  {blockTodos.length === 0 ? (
                    <p style={hintTextStyle(isDark)}>{t.calendar.classTodosHint}</p>
                  ) : (
                    blockTodos.map((ev) => (
                      <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 4, background: ev.color, flexShrink: 0 }} />
                        <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
                          {ev.title}
                        </span>
                        <span style={{ ...TYPE.caption, color: secondaryTextColor(isDark), whiteSpace: 'nowrap' }}>
                          {dayjs(ev.start).format('HH:mm')}–{dayjs(ev.end).format('HH:mm')}
                        </span>
                        <Button size="small" type="link" onClick={() => handleUnmerge(ev.id)}>
                          {t.calendar.unlinkTodo}
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              )}
              {!isTodo && <p style={{ ...hintTextStyle(isDark), marginTop: 12 }}>{t.calendar.holdHint}</p>}
            </div>
          );
        })()}
      </Modal>

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
