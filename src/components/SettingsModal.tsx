import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, Button, Table, Tag, message, Space, Popconfirm, Tabs, Spin } from 'antd';
import { llmConfigApi, promptTemplateApi, settingsApi } from '../api/client';
import { scheduleApi } from '../api/client';
import type { LLMConfig } from '../types';
import { useI18n } from '../i18n';
import { useTheme } from '../contexts/ThemeContext';

interface Props {
  open: boolean;
  onClose: () => void;
}

const PROVIDER_OPTIONS_ZH = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'ollama', label: 'Ollama (本地)' },
  { value: 'lmstudio', label: 'LM Studio (本地)' },
  { value: 'custom', label: '自定义提供商' },
];

const PROVIDER_OPTIONS_EN = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'ollama', label: 'Ollama (Local)' },
  { value: 'lmstudio', label: 'LM Studio (Local)' },
  { value: 'custom', label: 'Custom Provider' },
];

const DEFAULT_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234/v1',
  custom: '',
};

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  deepseek: 'deepseek-chat',
  ollama: 'llama3',
  lmstudio: '',
  custom: '',
};

const SettingsModal: React.FC<Props> = ({ open, onClose }) => {
  const { t, locale, setLocale } = useI18n();
  const { mode: themeMode, setMode: setThemeMode, isDark } = useTheme();

  const [configs, setConfigs] = useState<LLMConfig[]>([]);
  const [form] = Form.useForm();
  const [provider, setProvider] = useState('openai');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [promptTemplate, setPromptTemplate] = useState('');
  const [defaultTemplate, setDefaultTemplate] = useState('');
  const [promptSaving, setPromptSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('llm');
  const [debugLog, setDebugLog] = useState('');

  const PROVIDER_OPTIONS = locale === 'zh' ? PROVIDER_OPTIONS_ZH : PROVIDER_OPTIONS_EN;

  const loadConfigs = async () => {
    try {
      const data = await llmConfigApi.getAll();
      setConfigs(data);
    } catch {
      message.error(t.settings.loadFailed);
    }
  };

  const loadPromptTemplate = async () => {
    try {
      const data = await promptTemplateApi.get();
      setPromptTemplate(data.template);
      setDefaultTemplate(data.defaultTemplate);
    } catch {
      message.error(t.settings.templateLoadFailed);
    }
  };

  useEffect(() => {
    if (open) {
      loadConfigs();
      loadPromptTemplate();
    }
  }, [open]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (values.provider === 'custom' && !values.base_url) {
        message.error(t.settings.customProviderRequired);
        return;
      }
      await llmConfigApi.create(values);
      message.success(t.settings.added);
      form.resetFields();
      setProvider('openai');
      setTestResult(null);
      loadConfigs();
    } catch {
      // validation failed
    }
  };

  const handleActivate = async (id: number) => {
    try {
      await llmConfigApi.activate(id);
      message.success(t.settings.active);
      loadConfigs();
    } catch {
      message.error(t.settings.activateFailed);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await llmConfigApi.delete(id);
      message.success(t.settings.delete);
      loadConfigs();
    } catch {
      message.error(t.settings.deleteFailed);
    }
  };

  const handleTest = async () => {
    try {
      const values = await form.validateFields();
      setTesting(true);
      setTestResult(null);
      const result = await llmConfigApi.test({
        provider: values.provider,
        api_key: values.api_key,
        base_url: values.base_url,
        model: values.model,
      });
      setTestResult(result);
      if (result.success) {
        message.success(t.settings.testSuccess);
      } else {
        message.error(result.message || t.settings.testFailed);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || t.settings.testFailed;
      setTestResult({ success: false, message: msg });
      message.error(msg);
    } finally {
      setTesting(false);
    }
  };

  const handleTestExisting = async (config: LLMConfig) => {
    setTesting(true);
    try {
      const result = await llmConfigApi.test({ id: config.id });
      if (result.success) {
        message.success(t.settings.testSuccess);
      } else {
        message.error(result.message || t.settings.testFailed);
      }
    } catch (err: any) {
      message.error(err?.response?.data?.message || t.settings.testFailed);
    } finally {
      setTesting(false);
    }
  };

  const handleSaveTemplate = async () => {
    setPromptSaving(true);
    try {
      await promptTemplateApi.update(promptTemplate);
      message.success(t.settings.templateSaved);
    } catch {
      message.error(t.settings.templateSaveFailed);
    } finally {
      setPromptSaving(false);
    }
  };

  const handleResetTemplate = async () => {
    try {
      const result = await promptTemplateApi.reset();
      setPromptTemplate('');
      setDefaultTemplate(result.defaultTemplate);
      message.success(t.settings.templateReset);
    } catch {
      message.error(t.settings.templateSaveFailed);
    }
  };

  const columns = [
    {
      title: t.settings.provider,
      dataIndex: 'provider',
      render: (v: string) => v.toUpperCase(),
    },
    {
      title: t.settings.model,
      dataIndex: 'model',
    },
    {
      title: t.settings.status,
      dataIndex: 'is_active',
      render: (v: number) => v ? <Tag color="green">{t.settings.activated}</Tag> : <Tag>{t.settings.notActivated}</Tag>,
    },
    {
      title: t.settings.action,
      render: (_: any, record: LLMConfig) => (
        <Space>
          {!record.is_active && (
            <Button size="small" type="link" onClick={() => handleActivate(record.id)}>
              {t.settings.activate}
            </Button>
          )}
          <Button size="small" type="link" onClick={() => handleTestExisting(record)} loading={testing}>
            {t.settings.testConnection}
          </Button>
          <Popconfirm title={t.settings.confirmDelete} onConfirm={() => handleDelete(record.id)} okText={t.settings.delete} cancelText={t.settings.cancel}>
            <Button size="small" type="link" danger>{t.settings.delete}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const tabItems = [
    {
      key: 'llm',
      label: t.settings.llmConfig,
      children: (
        <>
          <div style={{ marginBottom: 24 }}>
            <h4>{t.settings.addConfig}</h4>
            <Form form={form} layout="vertical" initialValues={{ provider: 'openai' }}>
              <Form.Item name="provider" label={t.settings.provider} rules={[{ required: true }]}>
                <Select
                  options={PROVIDER_OPTIONS}
                  onChange={(v) => {
                    setProvider(v);
                    form.setFieldsValue({
                      base_url: DEFAULT_URLS[v],
                      model: DEFAULT_MODELS[v],
                    });
                    setTestResult(null);
                  }}
                />
              </Form.Item>
              {provider !== 'ollama' && provider !== 'lmstudio' && (
                <Form.Item name="api_key" label={t.settings.apiKey} rules={provider === 'custom' ? [] : [{ required: true, message: t.settings.enterApiKey }]}>
                  <Input.Password placeholder="sk-..." />
                </Form.Item>
              )}
              <Form.Item name="base_url" label={t.settings.apiUrl} rules={provider === 'custom' ? [{ required: true, message: t.settings.customProviderRequired }] : []}>
                <Input placeholder={DEFAULT_URLS[provider]} />
              </Form.Item>
              <Form.Item name="model" label={t.settings.modelName}>
                <Input placeholder={DEFAULT_MODELS[provider]} />
              </Form.Item>
              <Space>
                <Button type="primary" onClick={handleSubmit}>{t.settings.addConfig}</Button>
                <Button onClick={handleTest} loading={testing}>{t.settings.testConnection}</Button>
              </Space>
              {testResult && (
                <div style={{ marginTop: 8 }}>
                  <Tag color={testResult.success ? 'green' : 'red'}>{testResult.message}</Tag>
                </div>
              )}
            </Form>
          </div>

          <div>
            <h4>{t.settings.llmConfig}</h4>
            <Table
              columns={columns}
              dataSource={configs}
              rowKey="id"
              size="small"
              pagination={false}
            />
          </div>
        </>
      ),
    },
    {
      key: 'prompt',
      label: t.settings.promptTemplate,
      children: (
        <div>
          <div style={{ marginBottom: 8, color: isDark ? '#bbb' : '#999', fontSize: 12 }}>
            {t.settings.llmPromptHint}
          </div>
          <Input.TextArea
            value={promptTemplate}
            onChange={(e) => setPromptTemplate(e.target.value)}
            placeholder={defaultTemplate}
            rows={12}
            style={{ fontFamily: 'monospace', marginBottom: 12 }}
          />
          <Space>
            <Button type="primary" onClick={handleSaveTemplate} loading={promptSaving}>
              {t.settings.saveTemplate}
            </Button>
            <Button onClick={handleResetTemplate}>
              {t.settings.resetTemplate}
            </Button>
          </Space>
          {!promptTemplate && defaultTemplate && (
            <div style={{ marginTop: 16 }}>
              <h4>{t.settings.defaultTemplate}</h4>
              <pre style={{
                fontSize: 11,
                maxHeight: 200,
                overflow: 'auto',
                background: isDark ? '#303030' : '#f5f5f5',
                color: isDark ? '#d9d9d9' : undefined,
                padding: 8,
                borderRadius: 4,
                whiteSpace: 'pre-wrap',
              }}>
                {defaultTemplate}
              </pre>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'general',
      label: locale === 'zh' ? '通用设置' : 'General',
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div>
            <h4>{t.settings.language}</h4>
            <Select
              value={locale}
              onChange={setLocale}
              style={{ width: 200 }}
              options={[
                { value: 'zh', label: t.settings.chinese },
                { value: 'en', label: t.settings.english },
              ]}
            />
          </div>
          <div>
            <h4>{t.settings.theme}</h4>
            <Select
              value={themeMode}
              onChange={setThemeMode}
              style={{ width: 200 }}
              options={[
                { value: 'light', label: t.settings.light },
                { value: 'dark', label: t.settings.dark },
                { value: 'system', label: t.settings.system },
              ]}
            />
          </div>
          <div>
            <h4>{locale === 'zh' ? '调试日志' : 'Debug Log'}</h4>
            <Space style={{ marginBottom: 8 }}>
              <Button onClick={async () => {
                try {
                  const res = await fetch('/api/schedule/debug-log');
                  const data = await res.json();
                  setDebugLog(data.log || '(empty)');
                } catch { setDebugLog('(failed to load)'); }
              }}>{locale === 'zh' ? '刷新日志' : 'Refresh'}</Button>
              <Button danger onClick={async () => {
                try {
                  await fetch('/api/schedule/debug-log', { method: 'DELETE' });
                  setDebugLog('');
                  message.success(locale === 'zh' ? '已清理' : 'Cleared');
                } catch { message.error('Error'); }
              }}>{locale === 'zh' ? '清理日志' : 'Clear'}</Button>
            </Space>
            <Input.TextArea
              value={debugLog}
              readOnly
              rows={8}
              style={{ fontFamily: 'monospace', fontSize: 11 }}
              placeholder={locale === 'zh' ? '点击"刷新日志"查看最近10条' : 'Click "Refresh" to view last 10 entries'}
            />
          </div>
        </div>
      ),
    },
  ];

  return (
    <Modal
      title={t.settings.title}
      open={open}
      onCancel={onClose}
      footer={null}
      width={700}
    >
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </Modal>
  );
};

export default SettingsModal;
