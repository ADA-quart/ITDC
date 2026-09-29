<div align="center">

# ITDC

**本地优先的日历、待办与智能排程应用**

数据默认保存在本机，无需服务器即可完整使用；需要多设备共享时再启用同步服务。

[English](README.en.md) | **简体中文**

[![CI](https://github.com/ADA-quart/ITDC/actions/workflows/ci.yml/badge.svg)](https://github.com/ADA-quart/ITDC/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ADA-quart/ITDC)](https://github.com/ADA-quart/ITDC/releases/latest)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Web%20%7C%20Android-informational)

[下载 APK](https://github.com/ADA-quart/ITDC/releases/latest) · [功能](#功能) · [快速开始](#快速开始) · [文档](#文档)

</div>

---

## 项目定位

本项目的设计取向与常见的在线日历服务不同，主要体现在三个方面。

**数据默认存储在本机。** 日历、待办、排程、iCal 与 Excel 导入导出均在客户端完成，数据保存在浏览器的
IndexedDB 中。应用不要求注册账号，也没有云端依赖，断网状态下功能完整。服务器是一个可选项，
仅在需要多设备共享数据时启用。

**多端数据采用合并同步，而非覆盖。** 连接服务器时，本机与服务端的数据按稳定标识合并：两侧独有的
记录均予以保留，同一条记录以修改时间较新的一方为准。该行为与浏览器书签同步一致，不会以其中一侧
覆盖另一侧。

**Android 桌面小组件提供完整的交互能力。** 小组件包含今天与明天双栏课表、可滚动的待办清单，
支持直接勾选完成与划线标记；已结束的课程会自动隐去。外观采用圆角磨砂样式，并跟随系统深浅色设置。
该功能在纯本机模式下同样可用。

## 功能

### 日历管理

- 多日历管理，支持自定义名称与颜色
- 完整支持 **RRULE** 重复规则（RFC 5545），可用于表示每周固定的课程表
- iCal（`.ics`）文件导入与导出
- 日历交互：拖拽移动事件、拖动边缘调整时长、点击空白区域快速新建
- 导出本周为 Excel 工作簿，含周历视图与事件明细两张工作表

### 待办管理

- 基于**艾森豪威尔四象限**自动分级：按紧急度与重要度归入 P1 至 P4
- 状态流转：待办 → 已排程 → 已完成
- 截止日期倒计时，逾期项高亮显示
- 长任务自动拆分：超过 90 分钟的任务按时段切分，各段之间留出休息时间
- **自然语言录入**：输入「周五下午交报告」即可解析为结构化待办（需先配置 LLM）

### 智能排程

提供两种调度模式：

| 模式 | 是否需要服务器 | 说明 |
|------|----------------|------|
| **算法调度** | 否 | 贪心策略。按优先级与截止时间排序，避开已有日程，限定 7:00–23:00 工作时段，每连续工作满 2 小时插入 15 分钟休息 |
| **LLM 调度** | 是 | 将日程与待办交由大语言模型处理，生成更贴合语境的安排 |

两种模式生成的方案均会先行校验（时间冲突、深夜时段、超出截止时间），通过后方可应用。

LLM 支持 OpenAI、DeepSeek、Ollama、LM Studio 及任意兼容端点。API Key 使用 AES-256-GCM 加密存储，
接口不返回明文。

### Android 桌面小组件

- 顶栏显示最近有课所属的日历名、日期与教学周次
- **今天 / 明天**双栏课表，含彩色标记、课程名、地点与时间
- 待办清单可上下滚动，点按复选框即完成；已完成的条目显示删除线并排列至末尾
- 提供「全部完成」操作
- 已结束的课程自动隐去，无需打开应用
- 圆角磨砂外观，跟随系统深浅色设置
- 纯本机模式下同样可用：由应用将当日数据推送至原生侧渲染

实现细节与平台限制见 [docs/WIDGET.md](docs/WIDGET.md)。

### 其他

- 主题：浅色 / 深色 / 跟随系统
- 界面语言：简体中文 / English
- 离线可用：断网时数据读写正常，仅暂停同步
- 响应式布局：窄屏下改为上下堆叠，日历优先占满可视区域

## 快速开始

### 环境要求

- Node.js >= 18
- 构建 Android 客户端另需 JDK 21 与 Android SDK（compileSdk 36）

### 从源码运行

```bash
git clone https://github.com/ADA-quart/ITDC.git
cd ITDC
npm install
npm run dev:all
```

访问 http://localhost:5173 。默认即为「仅本机」模式，无需任何配置。

### Windows 一键脚本

依次双击 `install.bat` 与 `start.bat`。启动脚本会一并打印本机局域网 IP，便于手机端填写服务器地址。

### Android 客户端

从 [Releases](https://github.com/ADA-quart/ITDC/releases/latest) 下载 APK 安装。

> APK 使用 debug 签名，适用于个人使用与测试，不适合上架应用商店。
> 首次安装需允许「未知来源」；后续版本可直接覆盖安装，本地数据保留。

## 使用模式

| 模式 | 适用场景 | 配置方式 |
|------|----------|----------|
| **仅本机**（默认） | 单设备使用 | 无需配置 |
| **局域网** | 家庭或宿舍内，手机连接电脑 | 电脑执行 `npm start`，手机端在设置中填写 `http://<电脑IP>:3000/api` |
| **公网** | 任意网络下多设备同步 | 部署至云平台或使用内网穿透，填写 `https://<域名>/api` |

切换到「跨设备同步」时，本机与服务端数据会执行合并：两侧独有的记录均保留，同一条以修改时间较新者为准。

> ⚠️ 服务端不含账号体系。任何能访问该地址的人均可读写全部数据。公网部署前必须配置访问控制，
> 详见 [SECURITY.md](SECURITY.md)。

部署方式详见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 技术栈

| 层次 | 选型 |
|------|------|
| 前端 | React 18 · TypeScript · Ant Design 5 · FullCalendar 6 |
| 构建 | Vite 6 |
| 本地存储 | IndexedDB |
| 后端 | Express · sql.js（SQLite 的 WASM 实现，无需原生编译） |
| 移动端 | Capacitor 8 · 自研 Android 小组件插件 |

选型理由见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 项目结构

```
ITDC/
├── src/                 前端（React）
│   ├── api/             数据层：本地存储、本地算法、同步合并
│   ├── components/      界面组件
│   ├── i18n/            中英文文案
│   └── types/           共享类型定义
├── server/              后端（Express + sql.js）
│   ├── routes/          API 路由
│   ├── services/        排程、LLM、iCal 解析
│   └── db/              数据库封装与迁移
├── plugins/itdc-widget/ Android 桌面小组件（Capacitor 插件）
├── android/             Capacitor 生成的 Android 工程
├── docs/                文档
└── scripts/             构建脚本
```

## 文档

| 文档 | 内容 |
|------|------|
| [架构说明](docs/ARCHITECTURE.md) | 数据流、合并同步原理、技术选型理由、已知技术债 |
| [部署指南](docs/DEPLOYMENT.md) | 局域网、内网穿透、云平台与 Docker 部署 |
| [小组件](docs/WIDGET.md) | 小组件设计、数据通道、Android 平台限制 |
| [API 参考](docs/API.md) | 全部 HTTP 接口 |
| [安全说明](SECURITY.md) | 威胁模型、密钥管理、数据存放位置 |
| [变更日志](CHANGELOG.md) | 版本历史 |
| [贡献指南](CONTRIBUTING.md) | 开发环境与提交约定 |

## 配置

服务端配置通过 `.env` 提供。纯本机模式无需配置。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务监听端口 |
| `HOST` | `0.0.0.0` | 监听地址。仅允许本机访问时可设为 `127.0.0.1` |
| `DB_PATH` | `data/calendar.db` | SQLite 数据库文件位置 |
| `CRYPTO_SECRET` | 开发用默认值 | 加密 LLM API Key 的密钥。生产环境必须设置，可用 `openssl rand -hex 32` 生成 |
| `CORS_ORIGINS` | 空 | 额外允许的前端来源，多个以逗号分隔 |
| `CORS_ALLOW_ALL` | 空 | 设为 `1` 时放行任意来源，仅建议在纯内网使用 |

本机与局域网地址默认已放行。完整示例见 [.env.example](.env.example)。

## 可用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev:all` | 同时启动前端（5173）与后端（3000） |
| `npm run dev` | 仅启动前端 |
| `npm run dev:server` | 仅启动后端（热重载） |
| `npm run build` | 构建前端至 `dist/`，用于 Web 部署 |
| `npm run build:native` | 构建供 APK 使用的前端资源，并将 Service Worker 替换为清理脚本 |
| `npm start` | 以生产模式启动服务端 |
| `npm run android:sync` | 构建前端并同步资源至 Android 工程 |
| `npm test` | 运行单元测试 |

### 构建 APK

```bash
npm run android:sync
cd android && ./gradlew assembleDebug
```

产物位于 `android/app/build/outputs/apk/debug/app-debug.apk`。

构建顺序不可省略：单独执行 `gradlew` 不会重新打包前端资源。`build:native` 会将 PWA 的 Service Worker
替换为自我清理脚本，否则 APK 升级后 WebView 会从缓存加载旧代码，表现为「已安装新版本但功能未更新」。

## 常见问题

**小组件不自动刷新**

部分厂商定制系统（如澎湃 OS、MIUI）默认限制后台运行。请进入「设置 → 应用 → ITDC → 省电策略」
并设为**无限制**。应用内设置页会检测该状态并提供跳转入口。

**已结束的课程仍短暂显示**

课程隐去依赖系统定时刷新，Android 的最短刷新周期约为 30 分钟，因此课程结束后数分钟内可能仍然可见。

**手机无法连接电脑**

请确认两台设备处于同一网络，且电脑上已运行 `start.bat`。服务器地址填写 `http://<电脑IP>:3000/api`，
其中 IP 由 `start.bat` 打印。若仍无法连接，请检查 Windows 防火墙是否放行 3000 端口。

**数据存放位置与备份方式**

服务端模式下数据位于 `data/calendar.db`，定期复制该文件即可备份。仅本机模式下数据保存在浏览器
IndexedDB 中，可通过「导出 iCal」或「导出本周」导出。

**教学周次与实际校历不一致**

当前周次按「9 月 1 日所在周为第 1 周」推算，与各校实际校历可能存在偏差。

**APK 为何使用 debug 签名**

项目未配置发布用密钥库。个人使用不受影响，但不适合上架应用商店。

## 开发

提交前请确保以下命令均通过：

```bash
npx tsc --noEmit    # 类型检查
npx vitest run      # 单元测试
npm run build       # 构建
```

开发约定与注意事项见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE) © 2026 ADA-quart

第三方依赖的许可证见各依赖包内的 LICENSE 文件。
