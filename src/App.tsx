import React, { useState, useEffect } from 'react';
import * as offline from './api/offline';
import { todoApi, calendarApi, probeSync, isSyncEnabled } from './api/client';
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
import ReviewPage from './components/ReviewPage';
import SettingsView from './components/SettingsView';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { ITDCWidgetPlugin } from './capacitor/itdc-widget';
import { pushWidgetSnapshot, consumeWidgetDoneQueue } from './api/widget-sync';
import { maybeAutoSyncDaily } from './api/school-sync';
import { useI18n } from './i18n';
import { TOUCH_TARGET, withAlpha } from './components/ui';
import { FONT_STACK, tabularNums } from './components/ui';
import { useTheme } from './contexts/ThemeContext';
import { useIsMobile } from './hooks/useIsMobile';

const { Sider, Content } = Layout;

type PageKey = 'calendar' | 'todos' | 'schedule' | 'review' | 'settings';

const VALID_PAGES: PageKey[] = ['calendar', 'todos', 'schedule', 'review', 'settings'];

function getPageFromHash(): PageKey {
  const hash = window.location.hash.replace('#', '');
  if ((VALID_PAGES as string[]).includes(hash)) {
    return hash as PageKey;
  }
  return 'calendar';
}

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<PageKey>(getPageFromHash);
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
  const [isOffline, setIsOffline] = useState(false);
  const isMobile = useIsMobile();
  const { t, locale, setLocale } = useI18n();
  const { mode: themeMode, setMode: setThemeMode, isDark } = useTheme();
  const { appearance } = useTheme();

  useEffect(() => {
    const handler = () => setCurrentPage(getPageFromHash());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  useEffect(() => {
    let unsub: any;
    const setOfflineState = (online: boolean) => {
      // 仅本机模式：断网是正常状态（本来就不连服务器），不显示离线横幅。
      // 这条横幅只在「跨设备同步」开启、服务器不可达时才有意义。
      setIsOffline(!online && isSyncEnabled());
    };
    unsub = offline.onOnlineChange(setOfflineState);
    const handleOfflineMode = (e: any) => setIsOffline(e.detail?.mode === true && isSyncEnabled());
    window.addEventListener('todo-offline-mode', handleOfflineMode);
    return () => { if (unsub) unsub(); window.removeEventListener('todo-offline-mode', handleOfflineMode); };
  }, []);

    // 启动探测：确认服务器是否可用。
  // 不可达时整场会话退化为本机模式，后续请求不再白等超时——这是"本地优先"的关键一步。
  useEffect(() => {
    void probeSync().then((reachable) => {
      if (reachable) window.dispatchEvent(new CustomEvent('todo-data-changed'));
      else setIsOffline(false); // 本机模式不是异常状态，不显示离线警告
    });
  }, []);

  // 每天早上首次打开 App 时静默同步教务课表（精确 6 点后台受系统限制，这是等效方案）
  useEffect(() => {
    void maybeAutoSyncDaily();
  }, []);

  // 桌面小组件数据桥：启动时与每次数据变更后，把最新快照推给原生侧。
  // 仅本机模式下小组件读不到 WebView 的 IndexedDB，只能靠这条通道拿到数据。
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // 先消费桌面上的打勾操作（写回数据库），再推送快照，避免把过期状态又推回桌面
    const syncWidget = async () => {
      const changed = await consumeWidgetDoneQueue();
      if (changed > 0) window.dispatchEvent(new CustomEvent('todo-data-changed'));
      await pushWidgetSnapshot();
    };

    void syncWidget();
    const handler = () => { void pushWidgetSnapshot(); };
    // 同时监听两类事件：数据层变更（itdc-widget-sync）与视图级刷新（todo-data-changed）
    window.addEventListener('itdc-widget-sync', handler);
    window.addEventListener('todo-data-changed', handler);

    // 回到前台时：消费桌面的打勾 + 补推快照（覆盖跨天场景）
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncWidget();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.removeEventListener('itdc-widget-sync', handler);
      window.removeEventListener('todo-data-changed', handler);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // 视图（如日历加载失败）可发此事件引导用户直接打开设置
  useEffect(() => {
    const handler = () => {
      setSettingsTab('general');
      navigateTo('settings');
      setCurrentPage('settings');
    };
    window.addEventListener('itdc-open-settings', handler);
    return () => window.removeEventListener('itdc-open-settings', handler);
  }, []);

  // 从桌面小组件点进来：原生侧派发该事件，总是回到主页。
  // 应用被完全杀掉后点击小组件走的是冷启动，WebView 直接落到默认主页，不经过这里。
  useEffect(() => {
    const handler = () => {
      navigateTo('calendar');
      setCurrentPage('calendar');
    };
    window.addEventListener('itdc-open-home', handler);
    return () => window.removeEventListener('itdc-open-home', handler);
  }, []);

  // Android 返回键：交给 @capacitor/app 的原生回调处理。
  // 优先级 —— 先关掉最上层的弹窗，其次回退页面历史，最后才退出应用。
  // 只把设置做成页面还不够：Capacitor 核心不处理返回键，必须在这里显式接管。
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: { remove: () => Promise<void> } | undefined;
    void CapApp.addListener('backButton', ({ canGoBack }) => {
      // 弹窗以遮罩层形式挂载，取可见的最外层，点击它的关闭按钮触发组件自身的 onCancel
      const overlays = Array.from(document.querySelectorAll<HTMLElement>('.ant-modal-wrap'))
        .filter((el) => el.style.display !== 'none');
      const top = overlays[overlays.length - 1];
      if (top) {
        const closer = top.querySelector<HTMLElement>('.ant-modal-close, .ant-btn-default');
        if (closer) { closer.click(); return; }
      }
      // 底部导航切页不写历史（见 navigateTo），所以返回手势在任何页面都应当是「退出应用」。
      // 这里刻意不调用 history.back()：实测 WebView 会把 hash 变更也算进 back/forward 列表，
      // 一按返回就在「设置 ↔ 日历」之间来回走，永远退不出去（全面屏手势尤其明显）。
      void canGoBack;
      void CapApp.exitApp();
    }).then((l) => { handle = l; });
    return () => { void handle?.remove(); };
  }, []);

  // 启动时把当前服务器地址推给桌面小组件（仅同步模式；仅本机模式下小组件显示本机数据提示）
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const base = localStorage.getItem('itdc_api_base');
      // 空字符串或 null 表示仅本机：推 __local__ 让小组件给出准确文案而不是"未配置服务器"
      const url = base ? base : '__local__';
      void ITDCWidgetPlugin.setServerUrl({ url }).catch(() => {});
    } catch {}
  }, []);
  /**
   * 切页不写历史记录。
   *
   * 用 location.hash / location.replace 都会让 Android WebView 的 back/forward 列表增长，
   * 而全面屏手势（从屏幕边缘滑）就是系统返回键，于是"滑一下返回"变成沿着切页历史往回走：
   * 设置 → 日历 → 设置 → 日历……永远退不出去。replaceState 只改地址栏，不产生新条目。
   * 底部导航按 Material 的惯例本来也不该进返回栈；弹窗仍优先被返回手势关闭。
   */
  const navigateTo = (key: string) => {
    setCurrentPage(key as PageKey);
    try {
      window.history.replaceState(null, '', `#${key}`);
    } catch { /* 地址栏没更新不影响页面切换 */ }
  };

  const handleMenuClick = (key: string) => {
    navigateTo(key);
  };

  // 页面内部（如回顾页弹窗里的「去待办管理」）请求切页，走同一条不写历史的路径
  useEffect(() => {
    const handler = (e: Event) => {
      const page = (e as CustomEvent<{ page?: string }>).detail?.page;
      if (page) navigateTo(page);
    };
    window.addEventListener('itdc-navigate', handler);
    return () => window.removeEventListener('itdc-navigate', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderContent = () => {
    switch (currentPage) {
      case 'calendar':
        return <CalendarView />;
      case 'todos':
        return <TodoList />;
      case 'schedule':
        return <SchedulePanel />;
      case 'review':
    return <ReviewPage />;
      case 'settings':
        return <SettingsView initialTab={settingsTab} />;
    }
  };

  const antdLocale = locale === 'zh' ? zhCN : enUS;

  // 用户自定义主题色：antd token 负责组件层，CSS 变量负责零散样式
  const themeConfig = {
    algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: {
      colorPrimary: appearance.accent,
      // 手机上把控件放大到接近 44-48px 的触控目标（Material 48dp / HIG 44pt）
      borderRadius: isMobile ? 12 : 8,
      controlHeight: isMobile ? 40 : 32,
      fontSize: 14,
      // 中文界面：系统字体栈 + 稍宽的行高（中文比拉丁字母更吃行距）
      fontFamily: FONT_STACK,
      lineHeight: 1.6,
    },
    components: {
      Modal: { borderRadiusLG: 14 },
      Card: { borderRadiusLG: 12 },
      Segmented: { borderRadius: 10 },
    },
  };

  // 背景图铺在最底层（z-index:-1），页面容器改成透明才能真正透出来
  const hasBgImage = !!appearance.bgImage;
  const pageBg = hasBgImage ? 'transparent' : (isDark ? '#141414' : '#f5f5f5');

  // contain 模式图片会留边，给 body 一个主题底色，避免露出突兀的白/黑
  useEffect(() => {
    document.body.style.background = isDark ? '#141414' : '#f5f5f5';
  }, [isDark]);

  const backgroundLayer = hasBgImage ? (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        pointerEvents: 'none',
        backgroundImage: `url(${appearance.bgImage})`,
        backgroundSize: 'cover',
        backgroundPosition: `${appearance.bgFocusX}% ${appearance.bgFocusY}%`,
        backgroundRepeat: 'no-repeat',
        opacity: Math.max(0.1, appearance.bgOpacity / 100),
        // 模糊会在边缘采样到透明，放大一点盖住四角暗边
        filter: appearance.bgBlur ? `blur(${appearance.bgBlur}px)` : undefined,
        transform: `scale(${(appearance.bgBlur ? 1.08 : 1) * appearance.bgZoom})`,
        transformOrigin: `${appearance.bgFocusX}% ${appearance.bgFocusY}%`,
      }}
    />
  ) : null;

  const menuItems = [
    { key: 'calendar', icon: <CalendarOutlined />, label: t.nav.calendar },
    { key: 'todos', icon: <CheckSquareOutlined />, label: t.nav.todos },
    { key: 'schedule', icon: <ThunderboltOutlined />, label: t.nav.schedule },
    { key: 'review', icon: <PieChartOutlined />, label: t.nav.review },
    { key: 'settings', icon: <SettingOutlined />, label: t.nav.settings },
  ];

  // 仅同步模式下的网络异常才提示；仅本机模式属于正常使用，不显示任何警告横幅
  const offlineBanner = isOffline ? (
    <div style={{ position: 'sticky', top: 0, zIndex: 200, background: '#faad14', color: '#8a5a00', padding: '6px 12px', fontSize: 12, textAlign: 'center' }}>
      {t.app.offline}
    </div>
  ) : null;

  // 原生 APK 由 MainActivity 统一处理系统栏 insets（WebView 不解析 env()），
  // 这里只给浏览器/PWA 场景保留 CSS 安全区，避免两处叠加造成双重留白。
  const inset = (side: 'top' | 'bottom') =>
    Capacitor.isNativePlatform() ? '0px' : `env(safe-area-inset-${side}, 0px)`;

  if (isMobile) {
    return (
      <ConfigProvider locale={antdLocale} theme={themeConfig}>
        {backgroundLayer}
        {/* tabular-nums：时间/日期/计数在一列里对齐 */}
        <Layout style={{ minHeight: '100vh', background: 'transparent', ...tabularNums }}>
          <Content
            style={{
              padding: 12,
              background: pageBg,
              overflow: 'auto',
              // Android 15+ 强制 edge-to-edge：为状态栏与手势导航条留出空间
              paddingTop: `calc(12px + ${inset('top')})`,
              paddingBottom: `calc(64px + ${inset('bottom')})`,
            }}
          >
            {renderContent()}
{offlineBanner}
          </Content>
          <div style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
        background: `var(--itdc-nav-bg, ${isDark ? '#1f1f1f' : '#fff'})`,
        backdropFilter: 'var(--itdc-nav-blur, none)',
            borderTop: `1px solid ${isDark ? '#303030' : '#f0f0f0'}`,
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
            height: `calc(56px + ${inset('bottom')})`,
            paddingBottom: inset('bottom'),
            zIndex: 100,
            paddingLeft: 8,
            paddingRight: 8,
          }}>
            {menuItems.map(item => (
              <div
                key={item.key}
                onClick={() => handleMenuClick(item.key)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  // 拇指热区：底部导航是最高频入口，整块都要能点中（≥48dp）
                  minWidth: 56,
                  minHeight: TOUCH_TARGET,
                  padding: '4px 10px',
                  borderRadius: 12,
                  cursor: 'pointer',
                  userSelect: 'none',
                  WebkitTapHighlightColor: 'transparent',
                  background: currentPage === item.key ? withAlpha(appearance.accent, isDark ? 0.22 : 0.1) : 'transparent',
                  color: currentPage === item.key ? appearance.accent : (isDark ? '#aaa' : '#666'),
                  fontWeight: currentPage === item.key ? 600 : 400,
                  fontSize: 11,
                }}
              >
                {React.cloneElement(item.icon as React.ReactElement, {
                  style: { fontSize: 20 },
                })}
                {item.label}
              </div>
            ))}
          </div>
        </Layout>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider locale={antdLocale} theme={themeConfig}>
      {backgroundLayer}
      <Layout style={{ minHeight: '100vh', background: 'transparent' }}>
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
              ]}
            />
          </div>
          <div style={{ position: 'absolute', bottom: 12, width: 200, textAlign: 'center', fontSize: 11, color: '#bfbfbf' }}>
            {t.app.designBy}
          </div>
        </Sider>
        <Content style={{ padding: 24, background: pageBg, overflow: 'auto' }}>
          {renderContent()}
{offlineBanner}
        </Content>
      </Layout>
    </ConfigProvider>
  );
};

export default App;
