import React, { useEffect } from 'react';
import { Modal, Form, Input, InputNumber, DatePicker, Slider, message } from 'antd';
import dayjs from 'dayjs';
import { todoApi } from '../api/client';
import type { Todo } from '../types';
import { getPriorityFromUrgencyImportance } from '../utils/priority';

interface Props {
  visible: boolean;
  todo: Todo | null;
  onClose: () => void;
  onSaved: () => void;
}

const PRIORITY_LABELS: Record<string, string> = {
  'urgent-important': '紧急重要 (P1)',
  'important': '重要不紧急 (P2)',
  'urgent': '紧急不重要 (P3)',
  'normal': '普通 (P4)',
};

const TodoForm: React.FC<Props> = ({ visible, todo, onClose, onSaved }) => {
  const [form] = Form.useForm();

  useEffect(() => {
    if (visible && todo) {
      form.setFieldsValue({
        title: todo.title,
        description: todo.description,
        estimated_minutes: todo.estimated_minutes,
        urgency: todo.urgency,
        importance: todo.importance,
        deadline: todo.deadline ? dayjs(todo.deadline) : undefined,
      });
    } else if (visible) {
      form.resetFields();
    }
  }, [visible, todo]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      // priority 由后端根据 urgency/importance 自动计算，无需前端发送
      const data = {
        title: values.title,
        description: values.description,
        estimated_minutes: values.estimated_minutes,
        urgency: values.urgency,
        importance: values.importance,
        deadline: values.deadline ? values.deadline.toISOString() : null,
      };

      if (todo) {
        await todoApi.update(todo.id, data);
        message.success('待办已更新');
      } else {
        await todoApi.create(data);
        message.success('待办已创建');
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
  const priorityLabel = `优先级 (当前: ${PRIORITY_LABELS[priority]})`;

  return (
    <Modal
      title={todo ? '编辑待办' : '新建待办'}
      open={visible}
      onOk={handleSubmit}
      onCancel={onClose}
      okText="保存"
      cancelText="取消"
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ urgency: 2, importance: 2, estimated_minutes: 30 }}>
        <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
          <Input placeholder="待办标题" />
        </Form.Item>

        <Form.Item label={priorityLabel} style={{ marginBottom: 0 }}>
          <Form.Item name="urgency" label="紧急程度" style={{ display: 'inline-block', width: 'calc(50% - 8px)' }}>
            <Slider min={1} max={4} marks={{ 1: '低', 2: '中', 3: '高', 4: '极高' }} />
          </Form.Item>
          <Form.Item name="importance" label="重要程度" style={{ display: 'inline-block', width: 'calc(50% - 8px)', marginLeft: 16 }}>
            <Slider min={1} max={4} marks={{ 1: '低', 2: '中', 3: '高', 4: '极高' }} />
          </Form.Item>
        </Form.Item>

        <Form.Item name="estimated_minutes" label="预计时长 (分钟)" rules={[{ required: true, message: '请输入预计时长' }]}>
          <InputNumber min={5} max={480} step={15} style={{ width: '100%' }} placeholder="预计需要的分钟数" />
        </Form.Item>

        <Form.Item name="deadline" label="截止时间">
          <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} placeholder="选择截止时间" />
        </Form.Item>

        <Form.Item name="description" label="描述">
          <Input.TextArea rows={2} placeholder="补充说明" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default TodoForm;
