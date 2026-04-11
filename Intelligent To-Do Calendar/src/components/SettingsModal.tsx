import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, Button, Table, Tag, message, Space, Popconfirm } from 'antd';
import { llmConfigApi } from '../api/client';
import type { LLMConfig } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
}

const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'ollama', label: 'Ollama (本地)' },
];

const DEFAULT_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  ollama: 'http://localhost:11434',
};

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  deepseek: 'deepseek-chat',
  ollama: 'llama3',
};

const SettingsModal: React.FC<Props> = ({ open, onClose }) => {
  const [configs, setConfigs] = useState<LLMConfig[]>([]);
  const [form] = Form.useForm();
  const [provider, setProvider] = useState('openai');

  const loadConfigs = async () => {
    try {
      const data = await llmConfigApi.getAll();
      setConfigs(data);
    } catch {
      message.error('加载配置失败');
    }
  };

  useEffect(() => {
    if (open) loadConfigs();
  }, [open]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      await llmConfigApi.create(values);
      message.success('配置已添加');
      form.resetFields();
      setProvider('openai');
      loadConfigs();
    } catch {
      // validation failed
    }
  };

  const handleActivate = async (id: number) => {
    try {
      await llmConfigApi.activate(id);
      message.success('已激活');
      loadConfigs();
    } catch {
      message.error('激活失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await llmConfigApi.delete(id);
      message.success('已删除');
      loadConfigs();
    } catch {
      message.error('删除失败');
    }
  };

  const columns = [
    {
      title: '服务商',
      dataIndex: 'provider',
      render: (v: string) => v.toUpperCase(),
    },
    {
      title: '模型',
      dataIndex: 'model',
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      render: (v: number) => v ? <Tag color="green">已激活</Tag> : <Tag>未激活</Tag>,
    },
    {
      title: '操作',
      render: (_: any, record: LLMConfig) => (
        <Space>
          {!record.is_active && (
            <Button size="small" type="link" onClick={() => handleActivate(record.id)}>
              激活
            </Button>
          )}
          <Popconfirm title="确定删除此配置？" onConfirm={() => handleDelete(record.id)} okText="删除" cancelText="取消">
            <Button size="small" type="link" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Modal
      title="LLM 服务配置"
      open={open}
      onCancel={onClose}
      footer={null}
      width={640}
    >
      <div style={{ marginBottom: 24 }}>
        <h4>添加配置</h4>
        <Form form={form} layout="vertical" initialValues={{ provider: 'openai' }}>
          <Form.Item name="provider" label="服务商" rules={[{ required: true }]}>
            <Select
              options={PROVIDER_OPTIONS}
              onChange={(v) => {
                setProvider(v);
                form.setFieldsValue({
                  base_url: DEFAULT_URLS[v],
                  model: DEFAULT_MODELS[v],
                });
              }}
            />
          </Form.Item>
          {provider !== 'ollama' && (
            <Form.Item name="api_key" label="API Key" rules={[{ required: true, message: '请输入 API Key' }]}>
              <Input.Password placeholder="sk-..." />
            </Form.Item>
          )}
          <Form.Item name="base_url" label="API 地址">
            <Input placeholder={DEFAULT_URLS[provider]} />
          </Form.Item>
          <Form.Item name="model" label="模型名称">
            <Input placeholder={DEFAULT_MODELS[provider]} />
          </Form.Item>
          <Button type="primary" onClick={handleSubmit}>添加</Button>
        </Form>
      </div>

      <div>
        <h4>已有配置</h4>
        <Table
          columns={columns}
          dataSource={configs}
          rowKey="id"
          size="small"
          pagination={false}
        />
      </div>
    </Modal>
  );
};

export default SettingsModal;
