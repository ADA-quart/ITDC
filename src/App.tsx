import React, { useState, useEffect } from 'react';
import * as offline from './api/offline';
import { todoApi, calendarApi } from './api/client';
import { ConfigProvider, Layout, Menu, theme as antTheme, Button } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import {
  CalendarOutlined,
  CheckSquareOutlined,
  ThunderboltOutlined,
  SettingOutlined,
  SunOutlined,
  MoonOutlined,
  GlobalOutlined,
  PieChartOutlined,
} from '@ant-design/icons';
import CalendarView from './components/CalendarView';
import TodoList from './components/TodoList';
import SchedulePanel from './components/SchedulePanel';
import DailyReview from './components/DailyReview';
import SettingsModal from './components/SettingsModal';
import { useI18n } from './i18n';
import { useTheme } from './contexts/ThemeContext';

const { Sider, Content } = Layout;

type PageKey = 'calendar' | 'todos' | 'schedule' | 'review';

const VALID_PAGES: PageKey[] = ['calendar', 'todos', 'schedule', 'review'];

function getPageFromHash(): PageKey {
  const hash = window.location.hash.replace('#', '');
  if ((VALID_PAGES as string[]).includes(hash)) {
    return hash as PageKey;
  }
  return 'calendar';
}

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<PageKey>(getPageFromHash);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const { t, locale, setLocale } = useI18n();
  const { mode: themeMode, setMode: setThemeMode, isDark } = useTheme();

  useEffect(() => {
    const handler = () => setCurrentPage(getPageFromHash());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    let unsub: any;
    const setOfflineState = (online: boolean) => {
      setIsOffline(!online);
      if (online) {
        void offline.flushQueue(todoApi, calendarApi).then(() => window.dispatchEvent(new CustomEvent('todo-data-changed')));
      }
    };
    unsub = offline.onOnlineChange(setOfflineState);
    const handleOfflineMode = (e: any) => setIsOffline(e.detail?.mode === true);
    window.addEventListener('todo-offline-mode', handleOfflineMode);
    return () => { if (unsub) unsub(); window.removeEventListener('todo-offline-mode', handleOfflineMode); };
  }, []);
  const handleMenuClick = (key: string) => {
    window.location.hash = key;
    setCurrentPage(key as PageKey);
  };

  const renderContent = () => {
    switch (currentPage) {
      case 'calendar':
        return <CalendarView />;
      case 'todos':
        return <TodoList />;
      case 'schedule':
        return <SchedulePanel />;
      case 'review':
        return <DailyReview />;
    }
  };

  const antdLocale = locale === 'zh' ? zhCN : enUS;

  const menuItems = [
    { key: 'calendar', icon: <CalendarOutlined />, label: t.nav.calendar },
    { key: 'todos', icon: <CheckSquareOutlined />, label: t.nav.todos },
    { key: 'schedule', icon: <ThunderboltOutlined />, label: t.nav.schedule },
    { key: 'review', icon: <PieChartOutlined />, label: t.nav.review },
  ];

  const offlineBanner = isOffline ? (
    <div style={{ position: 'sticky', top: 0, zIndex: 200, background: '#faad14', color: '#8a5a00', padding: '6px 12px', fontSize: 12, textAlign: 'center' }}>
      {t.app.offline}
    </div>
  ) : null;

  if (isMobile) {
    return (
      <ConfigProvider
        locale={antdLocale}
        theme={{
          algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        }}
      >
        <Layout style={{ minHeight: '100vh' }}>
          <Content style={{ padding: 12, background: isDark ? '#141414' : '#f5f5f5', overflow: 'auto', paddingBottom: 64 }}>
            {renderContent()}
{offlineBanner}
          </Content>
          <div style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            background: isDark ? '#1f1f1f' : '#fff',
            borderTop: `1px solid ${isDark ? '#303030' : '#f0f0f0'}`,
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
            height: 56,
            zIndex: 100,
          }}>
            {menuItems.map(item => (
              <div
                key={item.key}
                onClick={() => handleMenuClick(item.key)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  cursor: 'pointer',
                  color: currentPage === item.key ? '#1890ff' : (isDark ? '#aaa' : '#666'),
                  fontSize: 11,
                }}
              >
                {React.cloneElement(item.icon as React.ReactElement, {
                  style: { fontSize: 20 },
                })}
                {item.label}
              </div>
            ))}
            <div
              onClick={() => setSettingsOpen(true)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                cursor: 'pointer',
                color: isDark ? '#aaa' : '#666',
                fontSize: 11,
              }}
            >
              <SettingOutlined style={{ fontSize: 20 }} />
              {t.nav.settings}
            </div>
          </div>
          <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </Layout>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider
      locale={antdLocale}
      theme={{
        algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
      }}
    >
      <Layout style={{ minHeight: '100vh' }}>
        <Sider width={200} theme={isDark ? 'dark' : 'light'}>
          <div style={{ padding: '16px', fontSize: 18, fontWeight: 'bold', textAlign: 'center', color: isDark ? '#fff' : undefined }}>
            {t.app.title}
          </div>
          <Menu
            mode="inline"
            selectedKeys={[currentPage]}
            onClick={(e) => handleMenuClick(e.key)}
            items={menuItems}
            theme={isDark ? 'dark' : 'light'}
          />
          <div style={{ position: 'absolute', bottom: 48, width: 200, padding: '0 16px' }}>
            <Menu
              mode="inline"
              selectable={false}
              theme={isDark ? 'dark' : 'light'}
              items={[
                {
                  key: 'theme',
                  icon: isDark ? <SunOutlined /> : <MoonOutlined />,
                  label: isDark ? t.settings.light : t.settings.dark,
                  onClick: () => setThemeMode(isDark ? 'light' : 'dark'),
                },
                {
                  key: 'language',
                  icon: <GlobalOutlined />,
                  label: locale === 'zh' ? t.settings.english : t.settings.chinese,
                  onClick: () => setLocale(locale === 'zh' ? 'en' : 'zh'),
                },
                {
                  key: 'settings',
                  icon: <SettingOutlined />,
                  label: t.nav.settings,
                  onClick: () => setSettingsOpen(true),
                },
              ]}
            />
          </div>
          <div style={{ position: 'absolute', bottom: 12, width: 200, textAlign: 'center', fontSize: 11, color: '#bfbfbf' }}>
            {t.app.designBy}
          </div>
        </Sider>
        <Content style={{ padding: 24, background: isDark ? '#141414' : '#f5f5f5', overflow: 'auto' }}>
          {renderContent()}
{offlineBanner}
        </Content>
      </Layout>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </ConfigProvider>
  );
};

export default App;


