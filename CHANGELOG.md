# 变更日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.8.0] - 2026-10-03

### 新增

- 支持通过高校统一认证（CAS）登录教务系统，从「个人选课 → 课表查询 → 学期个人课表」导入课程表为日历事件。内置成都理工大学配置，学校列表可在设置中扩展
- 版本号升至 1.8.0（versionCode 17）

### 修复

- **小组件里点勾，方框不显示勾**。划线与排序会立刻更新，但复选框要等打开 App 才变色。
  原因是集合型子项在 `notifyAppWidgetViewDataChanged` 之后重绘时，启动器会跳过
  `setImageViewBitmap`（同一批动作里的划线、文字色都正常）。
  现在复选框改为「空心框 / 实心框 / 对勾」三层矢量资源 + `setColorFilter` 着色，
  仍然跟随用户自定义主题色，同时删掉了不再需要的两个旧图标与位图绘制代码
- **打开设置页后直接点「获取模型列表」提示「请先填写 API Key」**。表单固定默认停在 OpenAI，
  而用户启用的是别的服务商（例如 DeepSeek），于是找不到对应密钥。
  现在进入设置页时表单会自动对齐到当前启用的配置（只填服务商 / 地址 / 模型，绝不回填密钥），
  提示文案也改为「或把上方服务商选成已配置过的那一个」

### 变更

- 版本号升至 1.7.2（versionCode 16）

## [1.7.1] - 2026-09-30

### 修复

- **仅本机模式下「AI 添加」（自然语言录入）直接报错**。此前只走服务端接口，
  没有服务器就提示「需要连接已配置 LLM 的服务器」；现在由 App 直接调用大模型解析，
  提示词与字段校验提到 `shared/nl-todo-prompt.ts`，与服务端同源
- **给大模型的时间没有时区**。此前只下发 UTC 的 ISO 串，模型常回不带时区的裸时间
  （如 `07:00`），App 按本地时区解析后在 UTC+8 手机上会排到几小时前。
  现在下发「带偏移量的本地时间 + 对应 UTC」，并要求模型返回带偏移的 ISO 8601
- **模型列表可能用到过期密钥**。同一服务商存了多条配置时取的是数组第一条，
  而不是当前启用那条，表现为「Key 明明有效却认证失败」
- 自然语言录入的提示词补上当前时间（此前完全没有，「周五下午」这类相对时间只能靠模型猜）

### 变更

- 本机模式调用大模型的超时 90s → 180s（推理型模型排程动辄一两分钟）
- 排程校验新增「被安排在已过去的时间」检查，服务端与本机校验口径一致
- 版本号升至 1.7.1（versionCode 15）

## [1.7.0] - 2026-09-30

### 新增

- **本机模式的 LLM 排程**：不连服务器也能用大模型排程
  - 配置存本机 IndexedDB（`llm_configs`），不再因为「没有服务器」而整块报「加载配置失败」
  - API Key 交给 **Android Keystore**（AES-GCM，密钥不可导出）加密后保存，
    明文不落盘；设置页会写明密钥存在哪里
  - 排程由 App 直接调用服务商（OpenAI 兼容 / Ollama），提示词与响应解析与服务端共用
    `shared/llm-prompt.ts`，两种模式的规则不会各写一套
  - 「获取模型列表」「测试连接」在表单密钥为空时自动复用保险箱里的密钥，不必重复粘贴
  - 服务器模式下行为不变：配置与密钥仍留在服务器，由服务器出网

### 变更

- 「添加配置」后保留服务商 / 地址 / 模型，只清空密钥框，方便接着查模型列表
- 排程页在仅本机模式下显示对应说明，而不再提示「需要先配置服务器」
- 默认系统提示词、用户提示词拼接与模型响应解析收敛到 `shared/llm-prompt.ts`
- 版本号升至 1.7.0（versionCode 14）

### 修复

- 本机模式下 LLM 配置页此前完全不可用：读写都走服务器接口，没有服务器就整块失败

## [1.6.1] - 2026-09-30

### 修复

- **「获取模型列表」在仅本机模式下必然失败**。该按钮此前只走服务端代理
  （`POST /api/schedule/llm-config/models`），于是三种情况都拿不到列表：
  仅本机模式根本没有服务器、服务器被判定不可达、服务器进程还是旧版本没有这个接口。
  现在服务端路径失败会自动退回 **App 直连服务商**（OpenAI 兼容端点 `GET /models`，
  Ollama 为 `GET /api/tags`），提示里会标明来源「App 直连」。
  服务端可达时行为不变；模型列表请求的服务端超时也从 30s 压到 12s，避免干等。

## [1.6.0] - 2026-09-30

### 新增

- **外观自定义**（设置 → 外观）
  - 主题色：8 个预设色 + 取色器，作用于按钮、选中态与小组件强调色
  - 背景图：上传本地图片作为应用背景，自动压到长边 1920px 后存入 IndexedDB，可调不透明度与模糊
  - 小组件外观：面板底色、面板不透明度、明暗（跟随系统 / 浅色 / 深色）、是否使用背景图，改动即时同步到桌面
  - 面板不透明度可降到 0，当作纯文字挂件压在壁纸上
- **模型名称可点选**：LLM 配置支持「获取模型列表」，从 `GET /models`（OpenAI 兼容）或 `GET /api/tags`（Ollama）拉取后下拉选择，仍可手动输入
- **检查更新**：关于区显示当前版本，手动查询 GitHub Releases，只提示不强制下载
- **小组件点按回到主页**：桌面上任意位置点进 App 都回到日历首页，而不是上次停留的页面

### 变更

- **设置改为独立页面**：与日历、待办同级，返回手势逐级回退而不是直接退出应用
- 版本号升至 1.6.0（versionCode 12）

### 修复

- **Android 返回键在设置页直接退回桌面**：Capacitor 8 核心不再接管返回键，
  改由 `@capacitor/app` 的 `backButton` 事件处理，顺序为「关闭最上层弹窗 → 回退页面历史 → 退出应用」

## [1.5.0] - 2026-09-30

### ⚠️ 破坏性变更

- **应用包名从 `com.alpha.itdc` 改为 `io.github.adaquart.itdc`**

  Android 会把它们当作两个不同的应用，因此**升级时必须先卸载旧版本**，本地数据（IndexedDB）会一并清除。
  建议先在新旧版本中任一处执行「导出 iCal」备份，装好新版后再导入。

  改名的原因：旧包名使用了个人化前缀，不符合开源项目的命名惯例；新包名采用
  `io.github.<owner>.<project>` 形式，与仓库归属一致。

### 变更

- 小组件的广播 action 前缀同步更新为新包名（`io.github.adaquart.itdc.WIDGET_*`）
- 版本号升至 1.5.0（versionCode 11）

---

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
- **固定 APK 签名密钥**：GitHub Actions 的 runner 是临时的，此前每次构建都会新生成
  debug 密钥，导致每个 Release 的签名都不同、用户无法覆盖升级。现改为使用仓库 Secret
  中的固定密钥，CI 与本地构建产出可互相覆盖
- 移除未使用的 `@capacitor/push-notifications` 依赖，Firebase 相关组件不再打进 APK
- 删除死代码 `server/services/calendar.service.ts`

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

[1.7.2]: https://github.com/ADA-quart/ITDC/releases/tag/v1.7.2
[1.7.1]: https://github.com/ADA-quart/ITDC/releases/tag/v1.7.1
[1.7.0]: https://github.com/ADA-quart/ITDC/releases/tag/v1.7.0
[1.6.1]: https://github.com/ADA-quart/ITDC/releases/tag/v1.6.1
[1.6.0]: https://github.com/ADA-quart/ITDC/releases/tag/v1.6.0
[1.5.0]: https://github.com/ADA-quart/ITDC/releases/tag/v1.5.0
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
