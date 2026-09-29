# 桌面小组件（Android）

小组件是本项目最复杂的部分，因为 Android 对它有大量限制。这里记录设计与踩过的坑。

## 功能

- 顶栏：**最近有课的日历名** + 日期 + 教学周次
- 课表：**今天 / 明天** 双栏，各含彩色竖条、课程名、地点、时间
- 待办：复选框 + 标题 + 截止日期，**可点按完成**，已完成的显示划线并沉底
- 三个区域**各自可上下滑动**
- 圆角磨砂外观，跟随系统**日夜模式**自动切换
- **上过的课自动消失**（按结束时间过滤，无需打开 App）

## 为什么用集合型小组件

初版把内容渲染成一张**静态位图**塞进 `ImageView`。位图在桌面上**无法滚动** —— 这是硬限制，不是实现问题。

要实现滑动必须改用 `RemoteViewsService` + `ListView`，即「集合型小组件」。

## 数据从哪来

小组件运行在**独立进程**，读不到 WebView 的 IndexedDB，也没有网络可拉。所以由 App 主动推送快照：

```
App（IndexedDB）
   ↓ buildWidgetSnapshot()  整理成今日数据
   ↓ ITDCWidgetPlugin.pushSnapshot()
原生侧 SharedPreferences（widget_prefs）
   ↓ onDataSetChanged()
RemoteViewsService 渲染列表
```

推送时机：App 启动、任意数据变更、回到前台、切换数据模式。

## 点按完成待办的回传

小组件改不了数据库，所以采用「桌面先生效、App 后回写」：

```
点按复选框
   ↓ 立即写入原生队列（widget_done）
桌面立刻显示划线（零延迟）
   ↓ App 启动 / 回到前台
getDoneQueue() → 写回 IndexedDB → clearDoneQueue()
```

用 `pending_done` / `pending_undone` 两个集合实现互斥，这样**点错了可以再点一次取消**。
回写失败时保留队列，下次重试 —— 避免桌面状态与数据库永久不一致。

## 踩过的坑

这些限制都不是文档里显眼写着的，是实测撞出来的。改动小组件时请留意：

### 1. RemoteViews 只允许白名单控件

用 `<View>` 画分隔线会抛：

```
Class not allowed to be inflated android.view.View
```

整个小组件会显示成 `Can't load widget`。**分隔线和色条必须用 `ImageView`。**

### 2. 集合子项不能用 setOnClickPendingIntent

对 `ListView` 的子项调用 `setOnClickPendingIntent` 会被**静默忽略**，点击毫无反应。

必须 `setPendingIntentTemplate` + 子项 `setOnClickFillInIntent`，且模板 PendingIntent 必须是
**`FLAG_MUTABLE`** —— 用 `FLAG_IMMUTABLE` 会导致 fill-in 的 extras 被丢掉，接收到的 id 永远是 -1。

### 3. 不能用 sendBroadcast 通知自己

Provider 声明了 `android:permission="BIND_APPWIDGET"`，广播要求**发送方**持有该权限，
而 App 自己并不持有 —— 广播被系统静默丢弃，表现为「数据写进去了但桌面不更新」。

正确做法是直接调用刷新方法。

### 4. BIND_APPWIDGET 会拦截系统广播

时间/日期变化的广播同样受影响，因此单独用了一个不带该权限的 receiver
（`ITDCWidgetTimeChangeReceiver`）。

### 5. APK 升级后 WebView 加载旧 JS

Service Worker 缓存会导致装了新 APK 却跑旧代码，小组件因此收到旧格式数据。
`npm run build:native` 会把 SW 替换成自我清理脚本（见 `scripts/native-sw-killswitch.mjs`）。

## 刷新机制

Android 15+ 抬高了 `setInexactRepeating` 的最短周期，Doze 下还会跳过；澎湃 OS 更是会冻结后台。

因此定时只作兜底，主要依赖三个不依赖后台存活的时机：

1. App 推送快照时主动触发
2. `appwidget-provider` 的 `updatePeriodMillis`（系统托管）
3. App 回到前台时补推

代价：「上过的课自动消失」**最多滞后约 30 分钟**（系统最短周期）。刚下课那几分钟它可能还挂着。

## 国产 ROM 注意事项

澎湃 OS / MIUI 默认会限制后台。如果小组件长时间不刷新：

**设置 → 应用 → ITDC → 省电策略 → 无限制**

App 的设置页会检测电池优化状态并给出跳转入口。

## 相关文件

| 文件 | 作用 |
|------|------|
| `ITDCWidgetProvider.java` | 小组件主体：刷新、渲染、列表绑定 |
| `ITDCWidgetListService.java` | 三个列表的数据源与条目构建 |
| `ITDCWidgetActionReceiver.java` | 点按完成 / 全部完成的接收与队列写入 |
| `ITDCWidgetTimeChangeReceiver.java` | 时间或日期变化时重绘 |
| `WidgetDoneStore.java` | 完成状态的本地存储与回传队列 |
| `ITDCWidgetPlugin.java` | 暴露给 JS 的桥接接口 |
| `res/layout/widget_main.xml` | 主布局 |
| `res/values-night/colors.xml` | 深色模式配色 |
