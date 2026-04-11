import React, { useState, useEffect } from 'react';
import { ConfigProvider, Layout, Menu } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  CalendarOutlined,
  CheckSquareOutlined,
  ThunderboltOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import CalendarView from './components/CalendarView';
import TodoList from './components/TodoList';
import SchedulePanel from './components/SchedulePanel';
import SettingsModal from './components/SettingsModal';

const { Sider, Content } = Layout;

type PageKey = 'calendar' | 'todos' | 'schedule';

const VALID_PAGES: PageKey[] = ['calendar', 'todos', 'schedule'];

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

  useEffect(() => {
    const handler = () => setCurrentPage(getPageFromHash());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
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
    }
  };

  return (
    <ConfigProvider locale={zhCN}>
      <Layout style={{ minHeight: '100vh' }}>
        <Sider width={200} theme="light">
          <div style={{ padding: '16px', fontSize: 18, fontWeight: 'bold', textAlign: 'center' }}>
            智能日历规划
          </div>
          <Menu
            mode="inline"
            selectedKeys={[currentPage]}
            onClick={(e) => handleMenuClick(e.key)}
            items={[
              { key: 'calendar', icon: <CalendarOutlined />, label: '日历视图' },
              { key: 'todos', icon: <CheckSquareOutlined />, label: '待办管理' },
              { key: 'schedule', icon: <ThunderboltOutlined />, label: '智能规划' },
            ]}
          />
          <div style={{ position: 'absolute', bottom: 48, width: 200, padding: '0 16px' }}>
            <Menu
              mode="inline"
              selectable={false}
              onClick={() => setSettingsOpen(true)}
              items={[
                { key: 'settings', icon: <SettingOutlined />, label: '设置' },
              ]}
            />
          </div>
          <div style={{ position: 'absolute', bottom: 12, width: 200, textAlign: 'center', fontSize: 11, color: '#bfbfbf' }}>
            Designed by ADA-quart
          </div>
        </Sider>
        <Content style={{ padding: 24, background: '#f5f5f5', overflow: 'auto' }}>
          {renderContent()}
        </Content>
      </Layout>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </ConfigProvider>
  );
};

export default App;
