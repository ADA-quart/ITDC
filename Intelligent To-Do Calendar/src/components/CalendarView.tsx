import React, { useEffect, useState, useRef, useCallback } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import rrulePlugin from '@fullcalendar/rrule';
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
import ImportModal from './ImportModal';

const CalendarView: React.FC = () => {
  const [events, setEvents] = useState<any[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [hiddenCalendars, setHiddenCalendars] = useState<Set<number>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [addCalOpen, setAddCalOpen] = useState(false);
  const [addCalForm] = Form.useForm();
  const [form] = Form.useForm();
  const [exporting, setExporting] = useState(false);
  const calendarRef = useRef<FullCalendar>(null);

  // 使用 ref 存储 hiddenCalendars 的最新值，避免 useEffect 闭包问题
  const hiddenCalendarsRef = useRef<Set<number>>(hiddenCalendars);
  hiddenCalendarsRef.current = hiddenCalendars;

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
      .filter(t => t.scheduled_start && t.scheduled_end)
      .map(t => ({
        id: 'todo-' + t.id,
        title: '[待办] ' + t.title,
        start: t.scheduled_start as string,
        end: t.scheduled_end as string,
        backgroundColor: '#722ed1',
        borderColor: '#722ed1',
        extendedProps: { type: 'todo', ...t },
      }));
    setEvents([...fcEvents, ...todoEvents]);
  }, []);

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
        await calendarApi.create({ name: '我的日历', color: '#1890ff' });
        const newCals = await calendarApi.getAll();
        setCalendars(newCals);
      }
      buildEvents(evts, hiddenCalendarsRef.current);
    } catch {
      message.error('加载数据失败');
    }
  }, [buildEvents]);

  useEffect(() => { loadData(); }, [loadData]);

  // hiddenCalendars 变化时重新构建事件，使用 ref 确保拿到最新值
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
      title: '删除事件',
      content: '确定删除 "' + clickInfo.event.title + '" 吗？',
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        await calendarApi.deleteEvent(Number(clickInfo.event.id));
        loadData();
        message.success('已删除');
      },
    });
  };

  // 拖拽移动事件后持久化到后端
  const handleEventDrop = async (dropInfo: any) => {
    const props = dropInfo.event.extendedProps;
    if (props.type === 'todo') {
      // 待办事件拖拽：更新 scheduled_start/end
      try {
        await todoApi.update(props.id, {
          scheduled_start: dropInfo.event.startStr,
          scheduled_end: dropInfo.event.endStr,
        });
        message.success('待办时间已更新');
      } catch {
        message.error('更新待办时间失败');
        dropInfo.revert();
      }
      return;
    }
    try {
      await calendarApi.updateEvent(Number(dropInfo.event.id), {
        start_time: dropInfo.event.startStr,
        end_time: dropInfo.event.endStr,
      });
      message.success('事件时间已更新');
    } catch {
      message.error('更新事件时间失败');
      dropInfo.revert();
    }
  };

  // 调整事件持续时间后持久化到后端
  const handleEventResize = async (resizeInfo: any) => {
    const props = resizeInfo.event.extendedProps;
    if (props.type === 'todo') {
      try {
        await todoApi.update(props.id, {
          scheduled_start: resizeInfo.event.startStr,
          scheduled_end: resizeInfo.event.endStr,
        });
        message.success('待办时间已更新');
      } catch {
        message.error('更新待办时间失败');
        resizeInfo.revert();
      }
      return;
    }
    try {
      await calendarApi.updateEvent(Number(resizeInfo.event.id), {
        start_time: resizeInfo.event.startStr,
        end_time: resizeInfo.event.endStr,
      });
      message.success('事件时间已更新');
    } catch {
      message.error('更新事件时间失败');
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
      message.success('事件已创建');
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
      message.success('日历已创建');
      setAddCalOpen(false);
      addCalForm.resetFields();
      loadData();
    } catch { /* validation */ }
  };

  const handleDeleteCalendar = async (id: number) => {
    try {
      await calendarApi.delete(id);
      message.success('日历已删除');
      loadData();
    } catch {
      message.error('删除失败');
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
      message.success('本周日历已导出');
    } catch {
      message.error('导出失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 48px)', gap: 16 }}>
      <div style={{ width: 220, minWidth: 220, background: '#fff', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontWeight: 'bold' }}>日历列表</span>
          <Tooltip title="新建日历">
            <Button size="small" type="text" icon={<FolderAddOutlined />} onClick={() => setAddCalOpen(true)} />
          </Tooltip>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {calendars.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderRadius: 6, marginBottom: 4, background: hiddenCalendars.has(c.id) ? '#f5f5f5' : '#e6f7ff', opacity: hiddenCalendars.has(c.id) ? 0.5 : 1 }}>
              <Checkbox checked={!hiddenCalendars.has(c.id)} onChange={() => toggleCalendar(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>{c.name}</span>
              </Checkbox>
              {calendars.length <= 1 ? null : (
                <Popconfirm title={'删除日历 "' + c.name + '" 及其所有事件？'} onConfirm={() => handleDeleteCalendar(c.id)} okText="删除" cancelText="取消">
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} style={{ fontSize: 11 }} />
                </Popconfirm>
              )}
            </div>
          ))}
        </div>
        <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Button icon={<DownloadOutlined />} block loading={exporting} onClick={handleExportWeek}>导出本周</Button>
          <Button icon={<UploadOutlined />} block onClick={() => setImportOpen(true)}>导入 iCal</Button>
        </div>
      </div>

      <div style={{ flex: 1, background: '#fff', padding: 16, borderRadius: 8, overflow: 'auto' }}>
        <div style={{ marginBottom: 12 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); form.setFieldsValue({ calendar_id: calendars.length > 0 ? calendars[0].id : undefined }); setModalOpen(true); }}>新建事件</Button>
        </div>
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, rrulePlugin]}
          initialView="timeGridWeek"
          locale="zh-cn"
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

      <Modal title="新建事件" open={modalOpen} onOk={handleSubmit} onCancel={() => { setModalOpen(false); form.resetFields(); }} okText="创建" cancelText="取消">
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}><Input placeholder="事件标题" /></Form.Item>
          <Form.Item name="calendar_id" label="日历" rules={[{ required: true, message: "请选择日历" }]}>
            <Select placeholder="选择日历">{calendars.map(c => (<Select.Option key={c.id} value={c.id}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: c.color, marginRight: 8 }} />{c.name}</Select.Option>))}</Select>
          </Form.Item>
          <Form.Item name="start_time" label="开始时间" rules={[{ required: true, message: "请选择开始时间" }]}><DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="end_time" label="结束时间" rules={[{ required: true, message: "请选择结束时间" }]}><DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="location" label="地点"><Input placeholder="事件地点" /></Form.Item>
        </Form>
      </Modal>

      <Modal title="新建日历" open={addCalOpen} onOk={handleAddCalendar} onCancel={() => { setAddCalOpen(false); addCalForm.resetFields(); }} okText="创建" cancelText="取消">
        <Form form={addCalForm} layout="vertical" initialValues={{ color: "#52c41a" }}>
          <Form.Item name="name" label="日历名称" rules={[{ required: true, message: "请输入日历名称" }]}><Input placeholder="例如：工作、学习" /></Form.Item>
          <Form.Item name="color" label="颜色"><ColorPicker /></Form.Item>
        </Form>
      </Modal>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={loadData} />
    </div>
  );
};

export default CalendarView;
