import React, { useEffect, useState, useRef, useCallback } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import rrulePlugin from '@fullcalendar/rrule';
import zhCnLocale from '@fullcalendar/core/locales/zh-cn';
import enLocale from '@fullcalendar/core/locales/en-gb';
import {
  Button, Modal, Form, Input, Select, DatePicker, message,
  Checkbox, Popconfirm, ColorPicker, Tooltip,
} from 'antd';
import {
  PlusOutlined, UploadOutlined, DeleteOutlined,
  FolderAddOutlined, DownloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { calendarApi, todoApi } from '../api/client';
import type { Calendar, CalendarEvent, Todo } from '../types';
import { TODO_PALETTE } from '../types';
import ImportModal from './ImportModal';
import { useI18n } from '../i18n';
import { useTheme } from '../contexts/ThemeContext';

const CalendarView: React.FC = () => {
  const { t, locale } = useI18n();
  const { isDark } = useTheme();
  const [events, setEvents] = useState<any[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [hiddenCalendars, setHiddenCalendars] = useState<Set<number>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [addCalOpen, setAddCalOpen] = useState(false);
  const [addCalForm] = Form.useForm();
  const [form] = Form.useForm();
  const [exporting, setExporting] = useState(false);
  const [exportingIcal, setExportingIcal] = useState(false);
  const calendarRef = useRef<FullCalendar>(null);

  const hiddenCalendarsRef = useRef<Set<number>>(hiddenCalendars);
  hiddenCalendarsRef.current = hiddenCalendars;

  const getTodoColor = (todo: Todo, index: number): string => {
    if (todo.color) return todo.color;
    return TODO_PALETTE[todo.id % TODO_PALETTE.length];
  };

  const buildEvents = useCallback(async (evts?: CalendarEvent[], currentHidden?: Set<number>) => {
    if (!evts) {
      evts = await calendarApi.getEvents();
    }
    const hidden = currentHidden || hiddenCalendarsRef.current;
    const todos = await todoApi.getAll({ status: 'scheduled' });
    const fcEvents = evts
      .filter((e: CalendarEvent) => !hidden.has(e.calendar_id))
      .map((e: CalendarEvent) => ({
        id: String(e.id),
        title: e.title,
        start: e.start_time,
        end: e.end_time,
        rrule: e.rrule || undefined,
        backgroundColor: e.calendar_color || '#1890ff',
        borderColor: e.calendar_color || '#1890ff',
        extendedProps: { ...e },
      }));
    const todoEvents = (todos as Todo[])
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
      setCalendars(cals);
      if (cals.length === 0 && !calInitRef.current.done) {
        calInitRef.current.done = true;
        await calendarApi.create({ name: t.calendar.defaultCalendarName, color: '#1890ff' });
        const newCals = await calendarApi.getAll();
        setCalendars(newCals);
      }
      buildEvents(evts, hiddenCalendarsRef.current);
    } catch {
      message.error(t.calendar.dataLoadFailed);
    }
  }, [buildEvents]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => { buildEvents(undefined, hiddenCalendars); }, [hiddenCalendars, buildEvents]);

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
      await calendarApi.exportWeek();
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
      await calendarApi.exportIcal();
      message.success(t.calendar.icalExported);
    } catch {
      message.error(t.calendar.exportFailed);
    } finally {
      setExportingIcal(false);
    }
  };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 48px)', gap: 16 }}>
      <div style={{ width: 220, minWidth: 220, background: isDark ? '#1f1f1f' : '#fff', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontWeight: 'bold' }}>{t.calendar.calendarList}</span>
          <Tooltip title={t.calendar.newCalendar}>
            <Button size="small" type="text" icon={<FolderAddOutlined />} onClick={() => setAddCalOpen(true)} />
          </Tooltip>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {calendars.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderRadius: 6, marginBottom: 4, background: hiddenCalendars.has(c.id) ? (isDark ? '#303030' : '#f5f5f5') : (isDark ? '#1a1a2e' : '#e6f7ff'), opacity: hiddenCalendars.has(c.id) ? 0.5 : 1 }}>
              <Checkbox checked={!hiddenCalendars.has(c.id)} onChange={() => toggleCalendar(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>{c.name}</span>
              </Checkbox>
              {calendars.length <= 1 ? null : (
                <Popconfirm title={t.calendar.deleteCalendar} onConfirm={() => handleDeleteCalendar(c.id)} okText={t.calendar.delete} cancelText={t.calendar.cancel}>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} style={{ fontSize: 11 }} />
                </Popconfirm>
              )}
            </div>
          ))}
        </div>
        <div style={{ borderTop: `1px solid ${isDark ? '#303030' : '#f0f0f0'}`, paddingTop: 12, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Button icon={<DownloadOutlined />} block onClick={() => setImportOpen(true)}>{t.calendar.importIcal}</Button>
          <Button icon={<UploadOutlined />} block loading={exportingIcal} onClick={handleExportIcal}>{t.calendar.exportIcal}</Button>
          <Button icon={<UploadOutlined />} block loading={exporting} onClick={handleExportWeek}>{t.calendar.exportWeek}</Button>
        </div>
      </div>

      <div style={{ flex: 1, background: isDark ? '#1f1f1f' : '#fff', padding: 16, borderRadius: 8, overflow: 'auto' }}>
        <div style={{ marginBottom: 12 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); form.setFieldsValue({ calendar_id: calendars.length > 0 ? calendars[0].id : undefined }); setModalOpen(true); }}>{t.calendar.newEvent}</Button>
        </div>
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, rrulePlugin]}
          initialView="timeGridWeek"
          locale={locale === 'zh' ? zhCnLocale : enLocale}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
          events={events}
          selectable
          editable
          select={handleDateSelect}
          eventClick={handleEventClick}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          height="auto"
          allDaySlot={true}
          slotMinTime="07:00:00"
          slotMaxTime="23:00:00"
        />
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
    </div>
  );
};

export default CalendarView;
