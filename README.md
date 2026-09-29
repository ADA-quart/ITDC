<div align="center">

# ITDC

**本地优先的日历 · 待办 · 智能排程**

不配服务器也能完整使用；需要时再开跨设备同步。

[![CI](https://github.com/ADA-quart/ITDC/actions/workflows/ci.yml/badge.svg)](https://github.com/ADA-quart/ITDC/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ADA-quart/ITDC)](https://github.com/ADA-quart/ITDC/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Web%20%7C%20Android-informational)

[下载 APK](https://github.com/ADA-quart/ITDC/releases/latest) · [功能](#功能) · [快速开始](#快速开始) · [文档](#文档)

</div>

---

## 这个项目和别的日历应用有什么不同

**默认不依赖服务器。** 数据存在你自己的设备上（IndexedDB），日历、待办、排程、iCal 与 Excel 导入导出全部本地完成。
没有注册、没有云端账号，断网照常用。

**服务器是可选项，不是前提。** 想多设备共享时再启动服务端。连接时**两端数据合并**（参考浏览器收藏夹同步的行为），
不会用其中一端覆盖另一端。

**桌面小组件是认真做的。** 不是一张静态截图 —— 今天/明天双栏课表、可滑动的待办清单、点按直接打勾、
已完成的显示删除线、上过的课自动消失、圆角磨砂外观跟随系统日夜模式。

## 功能

### 日历

- 多日历管理，自定义名称与颜色
- 完整 **RRULE** 重复规则支持（每周固定的课表就是靠它）
- iCal（`.ics`）导入导出
- 拖拽移动事件、拖边缘调整时长、点击空白处快速新建
- 导出本周为 Excel（周历视图 + 事件明细两张表）

### 待办

- **四象限优先级**：按紧急度与重要度自动归类 P1–P4
- 状态流转：待办 → 已排程 → 已完成
- 截止日期倒计时，逾期高亮
- 长任务自动拆分（超过 90 分钟按时段切分，每段之间留休息）
- **自然语言录入**：写「周五下午交报告」自动解析成结构化待办（需配置 LLM）

### 智能排程

两种模式：

| 模式 | 是否需要服务器 | 说明 |
|------|----------------|------|
| **算法调度** | 不需要 | 贪心策略：按优先级与截止时间排序，避开已有日程，7:00–23:00 工作时段，每连续 2 小时插入 15 分钟休息 |
| **LLM 调度** | 需要 | 把日程与待办交给大模型，生成更贴合语境的方案 |

两种方案都会先做校验（时间冲突、深夜时段、越过截止时间），通过后再应用。

LLM 支持 OpenAI / DeepSeek / Ollama / LM Studio / 自定义兼容端点。API Key 用 AES-256-GCM 加密存储，接口不返回明文。

### 桌面小组件（Android）

- 顶栏显示**最近有课的日历名**、日期与教学周次
- **今天 / 明天**双栏课表，含彩色竖条、课程名、地点、时间
- 待办清单**可上下滑动**，点按复选框直接完成，已完成的显示划线并沉底
- 一键「全部完成」
- **上过的课自动消失**，不需要打开 App
- 圆角磨砂，跟随系统日夜模式
- **纯本机模式也能用** —— App 把今日数据推送到原生侧渲染，无需服务器

细节与踩坑记录见 [docs/WIDGET.md](docs/WIDGET.md)。

### 其他

- 浅色 / 深色 / 跟随系统
- 中英文切换
- 离线可用：断网时数据读写正常，只是暂时不同步
- 响应式布局：手机端改上下堆叠，日历优先占满屏幕

## 快速开始

### Android

从 [Releases](https://github.com/ADA-quart/ITDC/releases/latest) 下载 APK 直接安装。

> 目前是 **debug 签名**，适合个人使用与测试。安装时系统可能提示「未知来源」。
> 升级新版本时直接覆盖安装即可，本地数据保留。

### 浏览器 / 桌面

```bash
git clone https://github.com/ADA-quart/ITDC.git
cd ITDC
npm install
npm run dev:all
```

打开 http://localhost:5173 即可。**默认已经是「仅本机」模式，不需要任何配置。**

### Windows 一键脚本

双击 `install.bat` 装依赖，再双击 `start.bat` 启动。`start.bat` 会自动检测局域网 IP 并打印出来，
方便手机连接。

## 三种使用形态

| 形态 | 适用场景 | 怎么用 |
|------|----------|--------|
| **仅本机**（默认） | 单设备使用 | 装完就用，无需任何配置 |
| **局域网** | 家里 / 宿舍，手机连电脑 | 电脑跑 `npm start`，手机设置里填 `http://电脑IP:3000/api` |
| **公网** | 任何网络下多设备同步 | 部署到云平台或内网穿透，填 `https://你的域名/api` |

切换到「跨设备同步」时，本机与服务器的数据会**合并**：两边独有的记录都保留，同一条按修改时间取新的。

> ⚠️ 服务端**没有账号体系**。谁能访问到地址，谁就能读写你的数据。公网部署前请先加访问控制，
> 详见 [SECURITY.md](SECURITY.md)。

部署细节见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 技术栈

| 层 | 选型 |
|----|------|
| 前端 | React 18 · TypeScript · Ant Design 5 · FullCalendar 6 |
| 构建 | Vite 6 |
| 本地存储 | IndexedDB |
| 后端 | Express · sql.js（SQLite 的 WASM 版，无需原生编译） |
| 移动端 | Capacitor 8 · 自研 Android 小组件插件 |

## 项目结构

```
ITDC/
├── src/                 前端（React）
│   ├── api/             数据层：本地存储、本地算法、同步合并
│   ├── components/      界面组件
│   ├── i18n/            中英文文案
│   └── types/           共享类型
├── server/              后端（Express + sql.js）
│   ├── routes/          API 路由
│   ├── services/        排程、LLM、iCal 解析
│   └── db/              数据库封装与迁移
├── plugins/itdc-widget/ Android 桌面小组件（Capacitor 插件）
├── android/             Capacitor 生成的 Android 工程
├── docs/                文档
└── scripts/             构建脚本
```

各模块职责与数据流见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 文档

| 文档 | 内容 |
|------|------|
| [架构说明](docs/ARCHITECTURE.md) | 数据流、合并同步原理、技术选型理由、已知技术债 |
| [部署指南](docs/DEPLOYMENT.md) | 局域网、内网穿透、云平台、Docker |
| [小组件](docs/WIDGET.md) | 桌面小组件设计、数据通道、Android 限制与踩坑 |
| [API 参考](docs/API.md) | 全部 HTTP 接口 |
| [安全说明](SECURITY.md) | 威胁模型、密钥、数据存放位置 |
| [变更日志](CHANGELOG.md) | 版本历史 |
| [贡献指南](CONTRIBUTING.md) | 开发与 PR 约定 |

## 配置

复制 `.env.example` 为 `.env`（仅服务端需要，纯本机模式不用管）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务端口 |
| `HOST` | `0.0.0.0` | 监听地址；只允许本机访问可设 `127.0.0.1` |
| `DB_PATH` | `data/calendar.db` | SQLite 文件位置 |
| `CRYPTO_SECRET` | 开发用默认值 | 加密 LLM API Key 的密钥。**生产环境必填**，用 `openssl rand -hex 32` 生成 |
| `CORS_ORIGINS` | 空 | 额外允许的前端来源，逗号分隔 |
| `CORS_ALLOW_ALL` | 空 | 设为 `1` 放行任意来源（仅建议纯内网使用） |

默认已放行本机与局域网地址。

## NPM 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev:all` | 同时启动前端（5173）与后端（3000） |
| `npm run dev` | 只启动前端 |
| `npm run dev:server` | 只启动后端（热重载） |
| `npm run build` | 构建前端到 `dist/`（用于 Web 部署） |
| `npm run build:native` | 构建前端供 APK 使用，并替换 Service Worker 为清理脚本 |
| `npm start` | 生产模式启动服务端 |
| `npm run android:sync` | 构建 + 同步资源到 Android 工程 |
| `npm test` | 运行单元测试 |

### 构建 APK

```bash
npm run android:sync
cd android && ./gradlew assembleDebug
```

产物在 `android/app/build/outputs/apk/debug/app-debug.apk`。

顺序不能省：只跑 `gradlew` 不会重新打包前端资源。`build:native` 会把 PWA 的 Service Worker 换成自我清理脚本 ——
否则升级 APK 后 WebView 会从缓存加载旧代码，表现为「装了新版但功能没变」。

## 常见问题

**小组件不自动刷新？**
国产 ROM（澎湃 OS / MIUI 等）默认限制后台。进「设置 → 应用 → ITDC → 省电策略」改为**无限制**。
App 的设置页会检测并给出跳转入口。

**课程消失太快 / 上过的课还显示？**
「上过的课自动消失」依赖系统定时刷新，Android 最短周期约 30 分钟，所以刚下课那几分钟可能还挂着。

**手机连不上电脑？**
确认在同一个 Wi-Fi，且电脑上 `start.bat` 已在运行。地址填 `http://电脑IP:3000/api`（`start.bat` 会打印 IP）。
Windows 防火墙可能拦截 3000 端口，需要放行。

**数据存在哪？怎么备份？**
服务端模式下是 `data/calendar.db`，定期复制这个文件即可。
仅本机模式下在浏览器的 IndexedDB 里，用「导出 iCal」或「导出本周」把数据取出来。

**教学周次不对？**
目前按「9 月 1 日所在周为第 1 周」估算，与各校实际校历可能不同。

**为什么 APK 是 debug 签名？**
没有配置发布用密钥库。个人使用没问题，但别拿去上架应用商店。

## 开发

```bash
npx tsc --noEmit    # 类型检查
npx vitest run      # 单元测试
npm run build       # 构建
```

约定与注意事项见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE) © 2026 ADA-quart

第三方依赖的许可证见各自包内的 LICENSE 文件。

---

<details>
<summary><b>English</b></summary>

**ITDC** — a local-first calendar, todo, and smart scheduling app.

Your data lives on your device by default (IndexedDB). The server is **optional**: run it only when you want
to share data across devices, and connecting **merges** both sides instead of overwriting one with the other.

- Multi-calendar with full RRULE support, iCal import/export, Excel weekly export
- Eisenhower-matrix todos with deadlines, task splitting, and natural-language input
- Two scheduling modes: a built-in greedy algorithm (works offline) or an LLM (OpenAI / DeepSeek / Ollama / LM Studio)
- Android home screen widget: today/tomorrow class columns, scrollable todo list with tap-to-complete,
  strikethrough on done, past classes auto-hide, rounded frosted look with automatic dark mode — works without a server

**Get started:** download the APK from [Releases](https://github.com/ADA-quart/ITDC/releases/latest),
or `npm install && npm run dev:all` for the web version. No configuration needed.

Docs: [Architecture](docs/ARCHITECTURE.md) · [Deployment](docs/DEPLOYMENT.md) · [Widget](docs/WIDGET.md) ·
[API](docs/API.md) · [Security](SECURITY.md)

Licensed under [MIT](LICENSE).

</details>
