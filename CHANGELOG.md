# 变更日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.4.0] - 2026-09-30

### 新增

- **两端数据合并同步**：连接服务器时不再用服务器数据覆盖本机，而是按 `sync_uid` 合并
  - 只有一端有的记录保留并补到另一端
  - 同一条记录两端都改过时，按 `updated_at` 取新的
  - 删除用墓碑表记录，避免被另一端同步回来
  - 新增服务端接口 `POST /api/sync/merge`

### 修复

- 事件表原有的 `uid` 列存 iCal UID，与同步标识语义冲突，同步统一改用 `sync_uid` 列
- 迁移前的历史数据缺少 `sync_uid`，合并时会被跳过（等于丢失），现自动补齐

### 变更

- 清理本地优先改造后失效的死代码（离线队列机制、旧位图渲染器及其布局）
- 新增 `.editorconfig` / `.gitattributes`，统一换行与缩进

## [1.3.0] - 2026-09-29

### 新增

- 小组件支持**点按复选框完成待办**，已完成的显示划线并沉到列表末尾
- 小组件新增「全部完成」按钮
- **上过的课自动消失**：按结束时间过滤，无需打开 App

### 修复

- 小组件里 `setOnClickPendingIntent` 对集合子项无效，改用 fill-in intent（模板需 `FLAG_MUTABLE`）

## [1.2.1] - 2026-09-29

### 新增

- 小组件顶栏显示**最近有课的日历名**（优先今天未开始的课，其次明天）

### 修复

- **重复课程不显示**：此前按 `start_time` 直接比对日期，RRULE 每周重复的课从第二次起就消失，现展开实际发生时间

## [1.2.0] - 2026-09-29

### 变更

- 小组件从静态位图**改为集合型**（`RemoteViewsService` + `ListView`），支持上下滑动
- 新增圆角磨砂背景、跟随系统的日夜模式
- 课表改为「今天 / 明天」双栏，含彩色竖条、地点与时间

### 修复

- RemoteViews 不允许 `<View>` 控件，分隔线与色条改用 `ImageView`，否则整块渲染失败
- APK 升级后 WebView 从 Service Worker 缓存加载旧 JS，导致小组件收到旧格式数据；改用清理脚本

## [1.1.2] - 2026-09-29

### 修复

- 小组件**默认按本机模式**运行。此前若曾配置过服务器地址，会一直尝试连接旧地址并报「连接不上服务器」
- 适配澎湃 OS / Android 16 的后台管控：改用 `setAndAllowWhileIdle`，时间变化用独立 receiver
- 设置页新增电池优化状态提示与跳转

## [1.1.1] - 2026-09-29

### 新增

- 桌面小组件支持**纯本机模式**：由 App 把今日数据快照推送给原生侧渲染，无需服务器

## [1.1.0] - 2026-09-29

### 变更

- **架构转向本地优先**：数据以客户端为第一数据源，服务器降级为可选的同步目标
  - 不配置服务器也能完整使用日历、待办、排程与导入导出
  - 排程算法、iCal 解析、Excel 导出全部本地实现
  - 设置页新增「仅本机 / 跨设备同步」切换，默认仅本机

### 修复

- 单实体响应缺少校验：POST/PUT 返回 HTML 时会把字符串当业务对象写入缓存，导致后续渲染崩溃

## [1.0.2] - 2026-09-29

### 修复

- 修复桌面小组件无法添加：`app_widget_itdc.xml` 属性误写成 `android.xxx`（点号而非冒号），编译产物属性名非法
- 手机端 UI 适配：日历左栏固定 220px 把日程挤成一条，设置弹窗固定 700px 溢出
- Android 15+ 强制 edge-to-edge 导致内容顶到状态栏

## [1.0.1] - 2026-09-28

### 修复

- 修复白屏：`base` 改为相对路径，适配 Capacitor 的 `file://` 加载
- 离线存储层 IndexedDB 改用正确的事务 API，并加内存回退
- API 响应非数组时归一化，避免渲染期崩溃

## [1.0.0] - 2026-09-25

### 新增

- 首个版本：多日历管理、四象限待办、算法与 LLM 双模式排程
- iCal 导入导出、Excel 周历导出
- 深色模式、中英文切换
- Android 桌面小组件（初版，静态位图）

[1.4.0]: https://github.com/ADA-quart/ITDC/releases/tag/v1.4.0
[1.3.0]: https://github.com/ADA-quart/ITDC/releases/tag/v1.3.0
[1.2.1]: https://github.com/ADA-quart/ITDC/releases/tag/v1.2.1
[1.2.0]: https://github.com/ADA-quart/ITDC/releases/tag/v1.2.0
[1.1.2]: https://github.com/ADA-quart/ITDC/releases/tag/v1.1.2
[1.1.1]: https://github.com/ADA-quart/ITDC/releases/tag/v1.1.1
[1.1.0]: https://github.com/ADA-quart/ITDC/releases/tag/v1.1.0
[1.0.2]: https://github.com/ADA-quart/ITDC/releases/tag/v1.0.2
[1.0.1]: https://github.com/ADA-quart/ITDC/releases/tag/v1.0.1
[1.0.0]: https://github.com/ADA-quart/ITDC/releases/tag/v1.0.0
