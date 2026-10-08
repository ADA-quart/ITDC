import React, { useEffect, useRef, useState } from 'react';
import { Modal, Form, Input, Select, Button, Table, Tag, message, Space, Popconfirm, Tabs, Spin, Alert, AutoComplete, Tooltip, Switch } from 'antd';
import { SyncOutlined, LinkOutlined } from '@ant-design/icons';
import { settingsApi, api, setApiBase, getApiBase, isSyncEnabled, calendarApi } from '../api/client';
import { Capacitor } from '@capacitor/core';
import { ITDCWidgetPlugin } from '../capacitor/itdc-widget';
import { pushWidgetSnapshot, setWidgetMode } from '../api/widget-sync';
import { mergeWithServer } from '../api/sync-merge';
import { checkForUpdate, getCurrentVersion, RELEASES_PAGE, type UpdateCheckResult } from '../api/update-check';
import { scheduleApi } from '../api/client';
import { llmConfigService } from '../api/llm-config-service';
import type { LLMConfig } from '../types';
import { useI18n } from '../i18n';
import { useTheme } from '../contexts/ThemeContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { getSelectedSchool, setSelectedSchool } from '../api/school-prefs';
import {
  isAndroid,
  syncClassReminders,
  requestClassReminderPermission,
  getClassReminderSilent,
  setClassReminderSilent,
} from '../api/reminders';
import {
  CLASS_LEAD_OPTIONS,
  getClassReminderEnabled,
  getClassReminderLeadMin,
  setClassReminderEnabled,
  setClassReminderLeadMin,
} from '../api/class-reminders';
import AppearanceSettings from './AppearanceSettings';
import { cardStyle, hintTextStyle, sectionTitleStyle } from './ui';

interface Props {
  /** 打开时要定位到的标签页，由「去设置」这类入口指定 */
  initialTab?: string;
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
  deepseek: 'deepseek-flash',
  ollama: 'llama3',
  lmstudio: '',
  custom: '',
};

const SettingsView: React.FC<Props> = ({ initialTab }) => {
  const { t, locale, setLocale } = useI18n();
  const { mode: themeMode, setMode: setThemeMode, isDark } = useTheme();
  const isMobile = useIsMobile();

  const [configs, setConfigs] = useState<LLMConfig[]>([]);
  const [form] = Form.useForm();
  const [provider, setProvider] = useState('openai');
  // 思考强度用受控 state：Form.Item 在 provider 切换后才挂载，
  // setFieldsValue 对未注册字段的时序不可靠，会出现"下拉框空白"。
  const [thinkingEffort, setThinkingEffort] = useState<'none' | 'low' | 'high' | 'max'>('low');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [promptTemplate, setPromptTemplate] = useState('');
  const [defaultTemplate, setDefaultTemplate] = useState('');
  const [promptSaving, setPromptSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('llm');
  const [serverUrl, setServerUrl] = useState(getApiBase());
  const [syncOn, setSyncOn] = useState(isSyncEnabled());
  const [batteryIgnoring, setBatteryIgnoring] = useState<boolean | null>(null);
  const [testingServer, setTestingServer] = useState(false);
  const [debugLog, setDebugLog] = useState('');
  const [schoolId, setSchoolId] = useState<string>('');
  const [classReminderOn, setClassReminderOn] = useState(getClassReminderEnabled());
  const [classLeadMin, setClassLeadMin] = useState(getClassReminderLeadMin());
  const [classReminderSilent, setClassReminderSilentState] = useState(getClassReminderSilent());
  // 表单是否已按「当前启用的配置」对齐过：只做一次，避免打断用户正在输入的内容
  const formSeeded = useRef(false);

  const PROVIDER_OPTIONS = locale === 'zh' ? PROVIDER_OPTIONS_ZH : PROVIDER_OPTIONS_EN;

  const loadConfigs = async () => {
    try {
      const data = await llmConfigService.getAll();
      setConfigs(data);
      // 首次进入设置页时，把表单对齐到当前启用的配置（只填服务商/地址/模型，绝不回填密钥）。
      // 否则表单默认停在 OpenAI，而用户启用的是 DeepSeek，
      // 点「获取模型列表」会因为「当前服务商没有密钥」而失败。
      if (!formSeeded.current && data.length > 0) {
        const active = data.find((c) => c.is_active) || data[0];
        formSeeded.current = true;
        setProvider(active.provider);
        if (active.provider === 'deepseek') {
          setThinkingEffort(active.thinking_effort || 'low');
        }
        form.setFieldsValue({
          provider: active.provider,
          base_url: active.base_url || DEFAULT_URLS[active.provider] || '',
          model: active.model || DEFAULT_MODELS[active.provider] || '',
        });
      }
    } catch {
      message.error(t.settings.loadFailed);
    }
  };

  const loadPromptTemplate = async () => {
    try {
      const data = await llmConfigService.getPromptTemplate();
      setPromptTemplate(data.template);
      setDefaultTemplate(data.defaultTemplate);
    } catch {
      message.error(t.settings.templateLoadFailed);
    }
  };

  // 进入设置页时加载配置
  useEffect(() => {
    loadConfigs();
    loadPromptTemplate();
    getSelectedSchool().then((id) => setSchoolId(id ?? '')).catch(() => {});
  }, []);

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  // 进入设置页时查询电池优化状态：澎湃 OS / MIUI 默认冻结后台，会导致小组件不刷新
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void ITDCWidgetPlugin.isIgnoringBatteryOptimizations()
      .then((r) => setBatteryIgnoring(r.ignoring))
      .catch(() => setBatteryIgnoring(null));
  }, []);

  const handleSaveServer = async () => {
    const raw = (serverUrl || '').trim().replace(/\/+$/, '');
    if (!raw) { message.error(locale === 'zh' ? '请填写服务器地址' : 'Please fill in the server address'); return; }
    if (!/^https?:\/\//i.test(raw)) { message.error(t.settings.serverInvalidFormat); return; }
    // 地址未以 /api 结尾时自动补全（用户常只填 http://IP:3000），再回退尝试原样地址
    const candidates = raw.endsWith('/api') ? [raw] : [raw + '/api', raw];
    let normalized: string | null = null;
    let lastStatus: number | null = null;
    setTestingServer(true);
    try {
      for (const cand of candidates) {
        try {
          const res = await api.get('/calendar/calendars', { baseURL: cand, timeout: 8000 });
          if (Array.isArray(res.data)) { normalized = cand; break; }
          lastStatus = 200; // 可达但返回的不是数组 → 不是 API 端点
        } catch (err: any) {
          if (err?.response?.status) lastStatus = err.response.status;
        }
      }
      if (!normalized) {
        message.error(lastStatus ? t.settings.serverNotApi : t.settings.serverUnreachable);
        return;
      }
      setApiBase(normalized);
      setServerUrl(normalized);
      setSyncOn(true);

      // 合并同步：把本机与服务器的数据合到一起，而不是用服务器覆盖本机。
      // 必须在 setApiBase 之后调用（此时请求才会打到新地址）。
      try {
        const merged = await mergeWithServer();
        message.success(
          locale === 'zh'
            ? `已合并：待办 ${merged.todos} 条、日历 ${merged.calendars} 个、事件 ${merged.events} 条（新增 ${merged.added}、更新 ${merged.updated}）`
            : `Merged: ${merged.todos} todos, ${merged.calendars} calendars, ${merged.events} events (added ${merged.added}, updated ${merged.updated})`
        );
      } catch (err: any) {
        message.warning(
          locale === 'zh'
            ? '已连接但合并失败：本地数据保持不变，可稍后重试'
            : 'Connected but merge failed; local data left unchanged'
        );
        console.warn('合并同步失败:', err);
      }

      if (Capacitor.isNativePlatform()) {
        try { await ITDCWidgetPlugin.setServerUrl({ url: normalized }); } catch {}
        try { await setWidgetMode('server'); } catch {}
      }
      window.dispatchEvent(new CustomEvent('todo-data-changed'));
    } finally {
      setTestingServer(false);
    }
  };

  const handleResetServer = () => {
    setApiBase(null);
    setServerUrl('');
    setSyncOn(false);
    if (Capacitor.isNativePlatform()) {
      void ITDCWidgetPlugin.setServerUrl({ url: '__local__' }).catch(() => {});
      void setWidgetMode('local').catch(() => {});
    }
    message.success(t.settings.serverReset);
    window.dispatchEvent(new CustomEvent('todo-data-changed'));
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (values.provider === 'custom' && !values.base_url) {
        message.error(t.settings.customProviderRequired);
        return;
      }
      await llmConfigService.create({
        ...values,
        thinking_effort: values.provider === 'deepseek' ? thinkingEffort : undefined,
      });
      message.success(t.settings.added);
      // 只清空密钥框：服务商/地址/模型留着，方便接着用「获取模型列表」
      // 复用刚存进保险箱的密钥，而不是把表单重置回 OpenAI 让用户重填一遍
      form.setFieldsValue({ api_key: '' });
      setTestResult(null);
      loadConfigs();
    } catch {
      // validation failed
    }
  };

  const handleActivate = async (id: number) => {
    try {
      await llmConfigService.activate(id);
      message.success(t.settings.active);
      loadConfigs();
    } catch {
      message.error(t.settings.activateFailed);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await llmConfigService.remove(id);
      message.success(t.settings.delete);
      loadConfigs();
    } catch {
      message.error(t.settings.deleteFailed);
    }
  };

  // 拉取服务商的可用模型列表，填进模型名的下拉里，省去手工输入
  const handleFetchModels = async () => {
    const values = form.getFieldsValue();
    const currentProvider = values.provider || provider;

    const needsKey = currentProvider !== 'ollama' && currentProvider !== 'lmstudio' && currentProvider !== 'custom';
    if (needsKey && !values.api_key) {
      // 本机模式下密钥可能已经在保险箱里（表单不回填密钥），先问一次再提示
      const saved = await llmConfigService.resolveApiKey({
        provider: currentProvider,
        baseUrl: values.base_url,
      });
      if (!saved) {
        message.warning(
          locale === 'zh'
            ? '请先填写 API Key，或把上方「服务商」选成已配置过的那一个'
            : 'Enter the API key, or pick the provider you already configured above'
        );
        return;
      }
    }

    setLoadingModels(true);
    try {
      const result = await llmConfigService.listModels({
        provider: currentProvider,
        api_key: values.api_key,
        base_url: values.base_url,
      });

      setModels(result.models || []);
      if (result.success && (result.models?.length ?? 0) > 0) {
        message.success(
          locale === 'zh'
            ? `获取到 ${result.models.length} 个模型${result.source === 'direct' ? '（App 直连）' : ''}，点击下拉选择`
            : `${result.models.length} models found${result.source === 'direct' ? ' (direct)' : ''} — pick one from the list`
        );
      } else {
        message.warning(
          result.message || (locale === 'zh' ? '未获取到模型列表，可手动填写' : 'No models found — enter one manually')
        );
      }
    } catch (err: any) {
      message.error(
        err?.response?.data?.message ||
          (locale === 'zh' ? '获取模型列表失败，可手动填写' : 'Failed to fetch models — enter one manually')
      );
    } finally {
      setLoadingModels(false);
    }
  };

  // 检查更新：查询 GitHub Releases，仅提示，不强制也不自动下载
  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    try {
      setUpdateResult(await checkForUpdate());
    } finally {
      setCheckingUpdate(false);
    }
  };

  /**
   * 打开外部链接。
   *
   * Capacitor 壳里 window.open / target=_blank 不会落到系统浏览器（MainActivity
   * 没接管 URL），所以走原生 startActivity 打开；浏览器里退回 window.open。
   */
  const openExternal = async (url: string) => {
    if (Capacitor.isNativePlatform()) {
      try {
        await ITDCWidgetPlugin.openUrl({ url });
        return;
      } catch {
        /* 原生打开失败就退回网页方式 */
      }
    }
    window.open(url, '_blank', 'noopener');
  };

  const updateMessage = (() => {
    if (!updateResult) return '';
    if (updateResult.status === 'up-to-date') return t.settings.upToDate;
    if (updateResult.status === 'update-available') return t.settings.updateAvailable + ' v' + updateResult.latest;
    switch (updateResult.error) {
      case 'rate-limited': return t.settings.updateErrRateLimited;
      case 'network': return t.settings.updateErrNetwork;
      case 'http': return t.settings.updateErrHttp + ' (HTTP ' + updateResult.httpStatus + ')';
      default: return t.settings.updateErrParse;
    }
  })();

  const handleTest = async () => {
    try {
      const values = await form.validateFields();
      setTesting(true);
      setTestResult(null);
      const result = await llmConfigService.test({
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
      const result = await llmConfigService.testExisting(config.id);
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
      await llmConfigService.savePromptTemplate(promptTemplate);
      message.success(t.settings.templateSaved);
    } catch {
      message.error(t.settings.templateSaveFailed);
    } finally {
      setPromptSaving(false);
    }
  };

  const handleResetTemplate = async () => {
    try {
      const result = await llmConfigService.resetPromptTemplate();
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
      render: (v: string, record: LLMConfig) => (
        <Space size={4} wrap>
          <span>{v}</span>
          {record.provider === 'deepseek' && (
            <Tag>{t.settings.thinkingShort[record.thinking_effort || 'low']}</Tag>
          )}
        </Space>
      ),
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

  // 设置变化后立刻按本机课表事件重排上课提醒（不依赖日历页面是否挂载）
  const resyncClassReminders = async () => {
    try {
      const evts = await calendarApi.getEvents();
      await syncClassReminders(Array.isArray(evts) ? evts : []);
    } catch (err) {
      console.warn('上课提醒重排失败:', err);
    }
  };

  const tabItems = [
    {
      key: 'llm',
      label: t.settings.llmConfig,
      children: (
        <>
          {/* 本机模式与服务器模式的配置存放位置完全不同，先把这件事说清楚 */}
          <Alert
            style={{ marginBottom: 16 }}
            type='info'
            showIcon
            message={
              llmConfigService.isLocalMode()
                ? t.settings.llmLocalTitle
                : t.settings.llmServerTitle
            }
            description={
              llmConfigService.isLocalMode()
                ? (Capacitor.isNativePlatform() ? t.settings.llmLocalDescSecure : t.settings.llmLocalDescWeb)
                : t.settings.llmServerDesc
            }
          />
          <div style={{ marginBottom: 24 }}>
            <h4 style={sectionTitleStyle}>{t.settings.addConfig}</h4>
            <Form form={form} layout="vertical" initialValues={{ provider: 'openai' }}>
              <Form.Item name="provider" label={t.settings.provider} rules={[{ required: true }]}>
                <Select
                  options={PROVIDER_OPTIONS}
                  onChange={(v) => {
                    setProvider(v);
                    if (v === 'deepseek') setThinkingEffort('low');
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
              <Form.Item label={t.settings.modelName}>
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="model" noStyle>
                    <AutoComplete
                      style={{ width: '100%' }}
                      placeholder={DEFAULT_MODELS[provider]}
                      options={models.map((m) => ({ value: m }))}
                      filterOption={(input, option) =>
                        String(option?.value ?? '').toLowerCase().includes(String(input).toLowerCase())
                      }
                    />
                  </Form.Item>
                  <Button icon={<SyncOutlined />} loading={loadingModels} onClick={handleFetchModels}>
                    {t.settings.fetchModels}
                  </Button>
                </Space.Compact>
                <div style={{ fontSize: 12, color: isDark ? '#a6a6a6' : '#666', marginTop: 4 }}>
                  {t.settings.modelHint}
                </div>
              </Form.Item>
              {provider === 'deepseek' && (
                <Form.Item label={t.settings.thinkingEffort}>
                  <Select
                    value={thinkingEffort}
                    onChange={(v: 'none' | 'low' | 'high' | 'max') => setThinkingEffort(v)}
                    options={[
                      { value: 'low', label: t.settings.thinkingLow },
                      { value: 'none', label: t.settings.thinkingNone },
                      { value: 'high', label: t.settings.thinkingHigh },
                      { value: 'max', label: t.settings.thinkingMax },
                    ]}
                  />
                  <div style={{ fontSize: 12, color: isDark ? '#a6a6a6' : '#666', marginTop: 4 }}>
                    {t.settings.thinkingEffortHint}
                  </div>
                </Form.Item>
              )}
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
            <h4 style={sectionTitleStyle}>{t.settings.llmConfig}</h4>
            <Table
              columns={columns}
              dataSource={configs}
              rowKey="id"
              size="small"
              pagination={false}
              scroll={{ x: 'max-content' }}
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
          <div style={{ marginBottom: 8, color: isDark ? '#a6a6a6' : '#666', fontSize: 12 }}>
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
              <h4 style={sectionTitleStyle}>{t.settings.defaultTemplate}</h4>
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
      key: 'appearance',
      label: t.settings.appearance,
      children: <AppearanceSettings />,
    },
    {
      key: 'general',
      label: locale === 'zh' ? '通用设置' : 'General',
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div>
            <h4 style={sectionTitleStyle}>{t.settings.language}</h4>
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
            <h4 style={sectionTitleStyle}>{t.settings.school}</h4>
            <Select
              value={schoolId || undefined}
              onChange={async (v) => {
                const id = v ?? '';
                setSchoolId(id);
                await setSelectedSchool(id || null);
                window.dispatchEvent(new Event('school-prefs-changed'));
                message.success(t.settings.schoolSaved);
              }}
              allowClear
              placeholder={t.settings.schoolNone}
              style={{ width: 240 }}
              options={[
                { value: 'cdut', label: '成都理工大学' },
              ]}
            />
          </div>
          {isAndroid() && (
            <div>
              <h4 style={sectionTitleStyle}>{t.settings.classReminder}</h4>
              <p style={{ fontSize: 12, color: isDark ? '#999' : '#666', marginBottom: 12 }}>
                {t.settings.classReminderHint}
              </p>
              <Space wrap>
                <Switch
                  checked={classReminderOn}
                  onChange={async (on) => {
                    setClassReminderEnabled(on);
                    setClassReminderOn(on);
                    if (on) {
                      const ok = await requestClassReminderPermission();
                      if (!ok) message.warning(t.settings.classReminderNoPerm);
                    }
                    await resyncClassReminders();
                    message.success(t.settings.classReminderSaved);
                  }}
                />
                <Select
                  value={classLeadMin}
                  disabled={!classReminderOn}
                  style={{ width: 150 }}
                  onChange={async (v) => {
                    setClassReminderLeadMin(v);
                    setClassLeadMin(v);
                    await resyncClassReminders();
                    message.success(t.settings.classReminderSaved);
                  }}
                  options={CLASS_LEAD_OPTIONS.map((m) => ({
                    value: m,
                    label: `${t.settings.classReminderLead} ${m} ${t.settings.classReminderMinutes}`,
                  }))}
                />
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Switch
                    checked={classReminderSilent}
                    disabled={!classReminderOn}
                    onChange={async (on) => {
                      setClassReminderSilent(on);
                      setClassReminderSilentState(on);
                      await resyncClassReminders();
                      message.success(t.settings.classReminderSaved);
                    }}
                  />
                  {t.settings.classReminderSilent}
                </span>
              </Space>
              <p style={{ ...hintTextStyle(isDark), marginTop: 8 }}>{t.settings.classReminderSilentHint}</p>
            </div>
          )}
          <div>
            <h4 style={sectionTitleStyle}>{t.settings.dataMode}</h4>
            <p style={{ fontSize: 12, color: isDark ? '#999' : '#666', marginBottom: 12 }}>
              {t.settings.dataModeHint}
            </p>
            <Tabs
              size="small"
              activeKey={syncOn ? 'sync' : 'local'}
              onChange={(key) => {
                if (key === 'local') {
                  handleResetServer();
                } else {
                  setSyncOn(true);
                }
              }}
              items={[
                {
                  key: 'local',
                  label: locale === 'zh' ? '仅本机' : 'This device only',
                  children: (
                    <Alert
                      type="success"
                      showIcon
                      message={locale === 'zh' ? '数据保存在本机，完全离线可用' : 'Data stays on this device; fully offline'}
                      description={
                        locale === 'zh'
                          ? '日历、待办、排程、iCal 与 Excel 导入导出全部在本机完成。换设备需手动导出/导入。'
                          : 'Calendar, todos, scheduling, iCal and Excel all run locally. Move data between devices via export/import.'
                      }
                    />
                  ),
                },
                {
                  key: 'sync',
                  label: locale === 'zh' ? '跨设备同步' : 'Sync across devices',
                  children: (
                    <div>
                      <p style={{ fontSize: 12, color: isDark ? '#999' : '#666', marginBottom: 8 }}>
                        {t.settings.syncHint}
                      </p>
                      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 8, alignItems: isMobile ? 'stretch' : 'center', flexWrap: 'wrap' }}>
                        <Input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder='http://192.168.x.x:3000/api' style={{ width: isMobile ? '100%' : 320 }} />
                        <Button type="primary" onClick={handleSaveServer} loading={testingServer} block={isMobile}>{locale === 'zh' ? '保存并测试' : 'Save & Test'}</Button>
                      </div>
                      <p style={{ fontSize: 12, color: isDark ? '#999' : '#666', marginTop: 8 }}>
                        {t.settings.widgetHint}
                      </p>
                    </div>
                  ),
                },
              ]}
            />
          </div>
          <div>
            <h4 style={sectionTitleStyle}>{t.settings.theme}</h4>
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

          {Capacitor.isNativePlatform() && (
            <div>
              <h4 style={sectionTitleStyle}>{t.settings.widgetSection}</h4>
              <p style={{ fontSize: 12, color: isDark ? '#999' : '#666', marginBottom: 8 }}>
                {t.settings.widgetLocalHint}
              </p>
              {batteryIgnoring === false && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 8 }}
                  message={t.settings.batteryTitle}
                  description={t.settings.batteryNeeded}
                  action={
                    <Button size="small" onClick={() => { void ITDCWidgetPlugin.openBatterySettings().catch(() => {}); }}>
                      {t.settings.batteryAction}
                    </Button>
                  }
                />
              )}
              {batteryIgnoring === true && (
                <p style={{ fontSize: 12, color: '#52c41a', margin: 0 }}>{t.settings.batteryOk}</p>
              )}
            </div>
          )}
          <div>
            <h4 style={sectionTitleStyle}>{locale === 'zh' ? '调试日志' : 'Debug Log'}</h4>
            <Space style={{ marginBottom: 8 }}>
              <Button onClick={async () => {
                try {
                  const data = await (await api.get('/schedule/debug-log')).data;
                  setDebugLog(data.log || '(empty)');
                } catch { setDebugLog('(failed to load)'); }
              }}>{locale === 'zh' ? '刷新日志' : 'Refresh'}</Button>
              <Button danger onClick={async () => {
                try {
                  await api.delete('/schedule/debug-log');
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
          <div>
            <h4 style={sectionTitleStyle}>{t.settings.about}</h4>
            <Space wrap style={{ marginBottom: 8 }}>
              <Tag>{t.settings.currentVersion} v{getCurrentVersion()}</Tag>
              <Button icon={<SyncOutlined />} loading={checkingUpdate} onClick={handleCheckUpdate}>
                {checkingUpdate ? t.settings.checking : t.settings.checkUpdate}
              </Button>
              <Button icon={<LinkOutlined />} onClick={() => void openExternal(RELEASES_PAGE)}>
                {t.settings.openSite}
              </Button>
            </Space>
            {updateResult && (
              <Alert
                style={{ marginBottom: 8 }}
                showIcon
                type={
                  updateResult.status === 'update-available' ? 'info' :
                  updateResult.status === 'up-to-date' ? 'success' : 'warning'
                }
                message={updateMessage}
                action={
                  updateResult.status === 'update-available' && updateResult.url ? (
                    <Button size='small' type='primary' onClick={() => void openExternal(updateResult.url!)}>
                      {t.settings.goDownload}
                    </Button>
                  ) : updateResult.status === 'error' ? (
                    <Button size='small' onClick={() => void openExternal(RELEASES_PAGE)}>
                      {t.settings.openSite}
                    </Button>
                  ) : undefined
                }
              />
            )}
            <p style={{ fontSize: 12, color: isDark ? '#999' : '#666', margin: 0 }}>
              {t.settings.updateHint}
            </p>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div style={cardStyle(isDark, isMobile)}>
      <h3 style={{ marginTop: 0, marginBottom: 12 }}>{t.settings.title}</h3>
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </div>
  );
};

export default SettingsView;
