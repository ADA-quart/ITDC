import React, { useEffect } from 'react';
import { Modal, Form, Input, InputNumber, DatePicker, Slider, message, ColorPicker } from 'antd';
import dayjs from 'dayjs';
import { todoApi } from '../api/client';
import type { Todo } from '../types';
import { useI18n } from '../i18n';
import { getPriorityFromUrgencyImportance } from '../utils/priority';

interface Props {
  visible: boolean;
  todo: Todo | null;
  onClose: () => void;
  onSaved: () => void;
}

const TodoForm: React.FC<Props> = ({ visible, todo, onClose, onSaved }) => {
  const { t } = useI18n();
  const [form] = Form.useForm();

  const priorityLabels: Record<string, string> = {
    'urgent-important': t.priority.p1,
    'important': t.priority.p2,
    'urgent': t.priority.p3,
    'normal': t.priority.p4,
  };

  useEffect(() => {
    if (visible && todo) {
      form.setFieldsValue({
        title: todo.title,
        description: todo.description,
        estimated_minutes: todo.estimated_minutes,
        urgency: todo.urgency,
        importance: todo.importance,
        deadline: todo.deadline ? dayjs(todo.deadline) : undefined,
        color: todo.color,
      });
    } else if (visible) {
      form.resetFields();
    }
  }, [visible, todo]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const colorStr = typeof values.color === 'string'
        ? values.color
        : (values.color?.toHexString?.() || undefined);
      const data = {
        title: values.title,
        description: values.description,
        estimated_minutes: values.estimated_minutes,
        urgency: values.urgency,
        importance: values.importance,
        deadline: values.deadline ? values.deadline.toISOString() : null,
        color: colorStr || undefined,
      };

      if (todo) {
        await todoApi.update(todo.id, data);
        message.success(t.todo.updated);
      } else {
        await todoApi.create(data);
        message.success(t.todo.created);
      }

      onClose();
      onSaved();
    } catch {
      // validation failed
    }
  };

  const urgency = Form.useWatch('urgency', form) || 2;
  const importance = Form.useWatch('importance', form) || 2;
  const priority = getPriorityFromUrgencyImportance(urgency, importance);
  const priorityLabel = t.todo.currentPriority.replaceAll('{label}', priorityLabels[priority]);

  return (
    <Modal
      title={todo ? t.todo.editTodo : t.todo.newTodo}
      open={visible}
      onOk={handleSubmit}
      onCancel={onClose}
      okText={t.todo.save}
      cancelText={t.todo.cancel}
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ urgency: 2, importance: 2, estimated_minutes: 30 }}>
        <Form.Item name="title" label={t.todo.title} rules={[{ required: true, message: t.todo.enterTitle }]}>
          <Input placeholder={t.todo.enterTitle} />
        </Form.Item>

        <Form.Item label={priorityLabel} style={{ marginBottom: 0 }}>
          <Form.Item name="urgency" label={t.todo.urgency} style={{ display: 'inline-block', width: 'calc(50% - 8px)' }}>
            <Slider min={1} max={4} marks={{ 1: t.todo.low, 2: t.todo.medium, 3: t.todo.high, 4: t.todo.veryHigh }} />
          </Form.Item>
          <Form.Item name="importance" label={t.todo.importance} style={{ display: 'inline-block', width: 'calc(50% - 8px)', marginLeft: 16 }}>
            <Slider min={1} max={4} marks={{ 1: t.todo.low, 2: t.todo.medium, 3: t.todo.high, 4: t.todo.veryHigh }} />
          </Form.Item>
        </Form.Item>

        <Form.Item name="estimated_minutes" label={t.todo.estimatedMinutes} rules={[{ required: true, message: t.todo.enterMinutes }]}>
          <InputNumber min={5} max={480} step={15} style={{ width: '100%' }} placeholder={t.todo.enterMinutes} />
        </Form.Item>

        <Form.Item name="deadline" label={t.todo.deadline}>
          <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} placeholder={t.todo.selectDeadline} />
        </Form.Item>

        <Form.Item name="color" label={t.todo.color}>
          <ColorPicker />
        </Form.Item>

        <Form.Item name="description" label={t.todo.description}>
          <Input.TextArea rows={2} placeholder={t.todo.supplementaryInfo} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default TodoForm;
