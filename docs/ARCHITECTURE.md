# 架构说明

## 一句话概括

**本地优先的日历 / 待办应用**：客户端持有权威数据，服务器是可选的跨设备同步目标。
排程、iCal 解析、Excel 导出全部在本地完成，断网和「不配服务器」都是正常状态。

## 数据流

```
         ┌──────────────────────────────────────┐
         │  客户端（浏览器 / PWA / Android App） │
         │                                      │
         │   React 界面                          │
         │      ↓                               │
         │   src/api/client.ts  ← 统一的读写入口  │
         │      ↓                               │
         │   IndexedDB（权威数据）                │
         └──────────────────────────────────────┘
                    │                 │
          启用同步时 │                 │ 始终
                    ↓                 ↓
         ┌──────────────────┐  ┌──────────────────┐
         │ Express 服务器    │  │ 桌面小组件（原生）│
         │ SQLite（镜像）    │  │ 读 App 推送的快照 │
         └──────────────────┘  └──────────────────┘
```

关键点：

- **所有写操作先落 IndexedDB 并立即返回**。服务器不可达不阻断用户操作，只标记为离线。
- **服务器是镜像不是权威**。连接服务器时走合并同步（见下），不覆盖本机。
- **小组件读不到 IndexedDB**（它在独立进程），所以由 App 主动推送一份数据快照给原生侧。

## 合并同步

两端各自有自增 id，**空间不一致**：客户端 id 是时间戳派生的大数字（约 81 万），服务端从 1 开始。
按 id 对齐会把 A 端第 N 条错配成 B 端第 N 条，因此合并一律按 **`sync_uid`**（客户端生成的稳定标识）匹配。

| 情况 | 处理 |
|------|------|
| 只有一端有 | 保留，补到另一端 |
| 两端都有，内容不同 | 比较 `updated_at`，新的赢 |
| 一端删除 | 写入墓碑表 `sync_tombstone`，两端一起删 |

相关实现：

- 服务端合并接口 —— `server/routes/sync.ts`
- 客户端调用入口 —— `src/api/sync-merge.ts`
- 字段迁移与历史数据补 uid —— `server/db/index.ts` 的 `runMigrations()`

> 新增可同步实体时，必须同时提供 `sync_uid` 与 `updated_at`，否则合并时会因缺少匹配键被跳过。

## 目录结构

```
ITDC/
├── src/                        前端（React）
│   ├── api/
│   │   ├── client.ts           统一数据入口：本地写入 + 可选服务器同步
│   │   ├── offline.ts          IndexedDB 读写、本地 id/uid 生成、墓碑
│   │   ├── local-scheduler.ts  本地排程算法（不依赖服务器）
│   │   ├── local-ical.ts       本地 iCal 解析与生成
│   │   ├── local-excel.ts      本地周历 Excel 导出
│   │   ├── sync-merge.ts       切换服务器时的合并同步
│   │   ├── widget-sync.ts      构造并推送桌面小组件快照
│   │   └── reminders.ts        Android 本地通知排程
│   ├── components/             界面组件
│   ├── contexts/               主题
│   ├── hooks/                  响应式布局
│   ├── i18n/                   中英文文案
│   └── types/                  共享类型
│
├── server/                     后端（Express + sql.js）
│   ├── index.ts                入口、CORS、静态托管
│   ├── db/                     数据库封装、schema、迁移
│   ├── routes/                 API 路由（calendar / todo / schedule / sync / widget / settings）
│   ├── services/               业务逻辑（排程、LLM、iCal 解析）
│   ├── llm/                    LLM 提供商适配（OpenAI 兼容 / Ollama）
│   └── utils/                  加密、调试日志
│
├── plugins/itdc-widget/        Android 桌面小组件（Capacitor 插件）
│   └── src/android/src/main/
│       ├── java/               小组件 Provider、列表服务、交互接收器
│       └── res/                布局、颜色（含 values-night 日夜模式）
│
├── android/                    Capacitor 生成的 Android 工程
├── scripts/                    构建辅助脚本
├── public/                     PWA 图标
├── docs/                       文档
└── data/                       SQLite 数据库（已 gitignore）
```

## 技术选型

| 层 | 选型 | 为什么 |
|----|------|--------|
| 前端 | React 18 + TypeScript + Ant Design 5 | 组件齐、中文生态好 |
| 日历 | FullCalendar 6 | 原生支持 RRULE 重复规则 |
| 构建 | Vite 6 | 快，配置少 |
| 本地存储 | IndexedDB | 容量够，支持结构化数据 |
| 后端 | Express + sql.js | sql.js 是 SQLite 的 WASM 版，**不需要原生编译**，部署省事 |
| 移动端 | Capacitor 8 | 复用同一套 Web 代码，能写原生插件 |
| 小组件 | RemoteViewsService | 静态位图无法滚动，集合型才能滑动 |

## 为什么用 sql.js 而不是 better-sqlite3

better-sqlite3 需要针对目标平台编译原生模块，在 Windows、Docker、云平台上容易出问题。
sql.js 是纯 WASM，装完就能跑。代价是数据库整体载入内存、每 5 秒整库写盘 —— 对个人使用量级完全够用。

## 已知技术债

诚实列出来，方便后来者判断：

1. **排程算法有两份实现** —— `src/api/local-scheduler.ts`（256 行）与 `server/services/scheduler.ts`（240 行）逻辑几乎相同，是本地优先改造时为离线可用而复制到客户端的。改规则需要同步改两处。
2. **同步是「最后写入者胜」** —— 不做字段级合并。两端同时改同一条记录的不同字段时，后写的会覆盖先写的。
3. **无鉴权、无多用户** —— 见 [SECURITY.md](../SECURITY.md) 的威胁模型。
4. **教学周次是估算的** —— 按「9 月 1 日所在周为第 1 周」推算，与各校实际校历可能不符。
