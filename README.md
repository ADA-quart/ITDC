<div align="center">

# 日日新 · ITDC

**本地优先的日历 + 待办 + 智能排程应用**

Web / PWA / Android 同一套代码，断网可用，服务器只是可选的同步端。

[English](README.en.md) · [架构说明](docs/ARCHITECTURE.md) · [部署指南](docs/DEPLOYMENT.md) · [API](docs/API.md) · [更新日志](CHANGELOG.md)

</div>

---

## 截图

| 日历 | 待办 | 排程 | 回顾 |
|:---:|:---:|:---:|:---:|
| ![日历](docs/images/app-calendar.png) | ![待办](docs/images/app-todos.png) | ![排程](docs/images/app-schedule.png) | ![回顾](docs/images/app-review.png) |

## 功能

**日历**
- 日 / 周 / 月视图，支持 RRULE 重复事件（基于 FullCalendar）
- 导入 `.ics` 日历文件，多日历合并与重复事件去重
- 课表视图：一键导入教务系统课程（目前支持成都理工大学），课程自动配色，可设置课前提醒

**待办**
- 优先级、截止时间、预估耗时、拆分子任务
- 自然语言新建待办（「明天下午三点交实验报告」），离线时走本地规则解析
- 截图 / 图片 OCR 识别成待办（PP-OCR 模型在本机运行，按需下载）

**智能排程**
- **算法模式**：纯本地，按优先级与截止时间把待办填进日历空闲时段
- **LLM 模式**：交给大模型排程，支持 OpenAI、DeepSeek、Ollama、LM Studio 及任意 OpenAI 兼容接口；可走服务器，也可由 App 直连服务商

**回顾与导出**
- 每日 / 每周回顾：课时、完成数、与上周对比、连续周数、逾期与补完的待办
- 导出 Excel 日程表

**Android**
- 桌面小组件：可滚动查看今日课程与待办，点按直接完成
- 本地通知提醒；API Key 用 Android Keystore 加密保存
- 小组件与 App 外观可自定义（背景图、透明度、液态玻璃效果）

**其他**
- 中英双语界面，浅色 / 深色 / 跟随系统
- 手机、平板（横屏三栏）、桌面三档自适应布局

## 设计思路

```
客户端（浏览器 / PWA / Android）
   React 界面 → src/api/client.ts → IndexedDB（权威数据）
        │ 启用同步时                     │ 始终
        ▼                                ▼
Express + SQLite（镜像）            桌面小组件（读快照）
```

- 所有写操作先落本机 IndexedDB 并立即返回，服务器不可达不影响使用。
- 服务器只是镜像：多设备之间按 `sync_uid` + `updated_at` 合并，删除用墓碑记录同步。
- 后端数据库用 sql.js（SQLite 的 WASM 版），无需原生编译，Windows / Docker / 云平台装完即跑。

详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 快速开始

需要 **Node.js 18+**。

### Windows 一键启动

双击 `install.bat` 安装依赖，之后双击 `start.bat` 启动，会自动打开浏览器。

### 命令行

```bash
npm install
cp .env.example .env     # 按需修改
npm run dev:all          # 前端 Vite + 后端 Express 同时启动
```

只想用纯本地功能（不需要同步、不走服务器 LLM）时，`npm run dev` 单独起前端即可。

### 生产运行

```bash
npm run build
npm start                # 默认 http://localhost:3000，同时托管前端与 /api
```

### Docker

```bash
echo "CRYPTO_SECRET=$(openssl rand -hex 32)" > .env
docker compose up -d
```

数据保存在 `itdc_data` 卷中。内网穿透、Railway、Render、VPS 等部署方式见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `PORT` | 后端端口 | `3000` |
| `HOST` | 监听地址 | `0.0.0.0` |
| `CRYPTO_SECRET` | 加密 LLM API Key 的 AES-256-GCM 密钥，**生产环境必填** | — |
| `DB_PATH` | SQLite 文件路径 | `data/calendar.db` |
| `CORS_ORIGINS` | 允许跨域的前端来源，逗号分隔 | 空 |
| `CORS_ALLOW_ALL` | 设为 `1` 放行所有来源，仅限内网自建 | 空 |
| `BACKEND_PORT` | Vite 开发代理指向的后端端口 | 同 `PORT` |

## 构建 Android

需要 Android Studio 与 JDK。

```bash
npm run android:sync     # 构建 Web 资源并同步到 android/
npm run android:open     # 用 Android Studio 打开工程
```

或直接在 `android/` 下执行 `./gradlew assembleDebug`，产物位于 `android/app/build/outputs/apk/debug/`。

小组件的实现细节与国产 ROM 注意事项见 [docs/WIDGET.md](docs/WIDGET.md)。

## 常用脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动前端开发服务器 |
| `npm run dev:server` | 启动后端（热重载） |
| `npm run dev:all` | 前后端一起启动 |
| `npm run build` | 构建前端到 `dist/` |
| `npm start` | 运行生产服务 |
| `npm test` | 运行 Vitest 测试 |
| `npm run licenses` | 重新生成第三方许可清单 |

## 目录结构

```
src/        前端（React + TypeScript + Ant Design）
  api/        数据入口、本地排程、LLM、OCR、同步、提醒
  components/ 界面组件
  i18n/       中英文案
server/     后端（Express + sql.js）
  routes/     calendar / todos / schedule / sync / school / widget / settings
  llm/        大模型服务商适配
shared/     前后端共用：提示词、排程策略、课表解析、去重
plugins/    Capacitor 原生插件（桌面小组件、安全存储）
android/    Android 工程
docs/       架构、部署、API、小组件文档
```

## 参与贡献

欢迎提 Issue 和 PR，请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可

© 2026 ADA-Quart & TyTs

本项目采用 [PolyForm Noncommercial 1.0.0](LICENSE) 许可：可自由用于个人学习、研究及非商业用途，**禁止商业使用**。第三方依赖的许可见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
