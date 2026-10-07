<div align="center">

<img src="public/icons/icon-512.png" width="108" alt="ITDC 应用图标：日历网格与闪电">

<h1>ITDC</h1>

<p><b>本地优先的日历 · 待办 · 智能排程</b><br>
把待办交给算法或大模型自动排进日历空档；课表、提醒、桌面小组件都在本机完成</p>

<p>
  <a href="https://github.com/ADA-quart/ITDC/releases/latest"><b>下载 Android APK</b></a> ·
  <a href="README.en.md">English</a> ·
  <a href="docs/ARCHITECTURE.md">架构说明</a> ·
  <a href="CHANGELOG.md">更新日志</a>
</p>

<p>
  <a href="https://github.com/ADA-quart/ITDC/actions/workflows/ci.yml"><img alt="CI 状态" src="https://github.com/ADA-quart/ITDC/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/ADA-quart/ITDC/releases/latest"><img alt="最新版本" src="https://img.shields.io/github/v/release/ADA-quart/ITDC"></a>
  <img alt="平台：Web / Android / PWA" src="https://img.shields.io/badge/platform-Web%20%7C%20Android%20%7C%20PWA-informational">
  <a href="LICENSE"><img alt="许可证：PolyForm Noncommercial 1.0.0" src="https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-orange.svg"></a>
</p>

<img src="docs/images/app-schedule.png" alt="ITDC 智能排程界面：待办被自动排入日历空档" width="880">

</div>

ITDC 是一个**给自己用**的日程应用：日历、四象限待办、智能排程、今日回顾、教务课表导入、到点提醒和 Android 桌面小组件。
它默认**只在本机运行**——不注册账号、不上传数据、没有服务器也能用完整功能；需要多设备时再自建一个同步服务。

它不做什么：不做团队协作、不做 SaaS、也不把你的课表和待办传到别人的服务器上。

---

## 功能一览

| 模块 | 能做什么 |
|------|----------|
| 🧠 **智能排程** | 算法调度或大模型调度，把未完成待办按优先级与截止时间排进日历空档，排完自动校验冲突 |
| 📅 **日历** | 多日历（各自颜色）、RRULE 重复规则、拖拽改期、拖边缘改时长、左右滑动翻页、日/周视图 |
| ✅ **待办** | 艾森豪威尔四象限自动分级 P1–P4、长任务拆分、倒计时与逾期高亮、自然语言录入 |
| 🎓 **课表导入** | 用学校统一认证（CAS）登录教务系统，按学期把整张课表导入为日历；每门课一个固定颜色 |
| ⏰ **提醒** | Android 本机通知：待办到点提醒、上课前提醒（可设提前分钟数，可静默不响铃） |
| 📱 **桌面小组件** | 今天/明天课表 + 待办清单，可滚动、可直接打勾，点任意位置进 App |
| 📊 **今日回顾** | 逾期 / 今日到期 / 待处理 / 已完成统计与近 7 天趋势 |
| 📥 **导入导出** | iCal 导入导出、导出本周为 Excel（手机端走系统分享面板） |
| 🎨 **个性化** | 浅色 / 深色 / 跟随系统、主题色与背景图、小组件独立配色、简体中文 / English |
| 📴 **离线** | 断网照常读写；启用同步后，联网时按 `sync_uid` 合并两端数据 |

## 智能排程

点一下「生成方案」，引擎读取全部未完成待办与现有日程，避开已占用时段，按优先级排出计划；确认后写入日历，之后随时可以拖拽微调。

| 模式 | 怎么排 | 适合 |
|------|--------|------|
| ⚡ 算法调度 | 本机确定性算法，不联网、瞬时出结果 | 想要可预期、可复现的排法 |
| 🧠 LLM 调度 | 交给大模型理解任务语义与偏好 | 任务描述复杂、需要模型判断拆分方式 |

算法调度的规则：四象限优先级排序 → 同级按截止时间 → 只用 7:00–23:00 工作时段 → 避开已有日程与已排期待办 → 单段最长 90 分钟、超长自动切分并插入休息。排完会校验时段冲突、超出工作时段、越过截止时间、已过去的时间，问题会列出来而不是悄悄写入。

LLM 调度的特点：**仅本机模式也能直连大模型**，由 App 自己组装提示词调用服务商；支持 OpenAI、DeepSeek、Ollama、LM Studio 与任意 OpenAI 兼容端点；提示词模板可在设置里改。API Key 在 Android 上由**系统 Keystore 加密保存**（浏览器版退化为本地明文，设置页会明确提示）。

## 课表导入（成都理工大学）

1. 设置 → 通用设置 → 「学校」选择**成都理工大学**（学校配置集中在 [`shared/schools.ts`](shared/schools.ts)，加新学校从这里开始）
2. 日历侧栏 → **导入教务课表** → 用学校统一认证的学号密码登录
3. 选择学期、填写第一周周一的日期 → 导入

导入结果是一个独立日历，每门课都有**自己的颜色**（同名课程永远同色），事件备注带教师、周次与节次。
勾选「记住账号密码」后，下次打开弹窗会自动用系统密钥库里的凭据登录。

> 原生 App 直连学校 CAS 与教务系统，不经过任何中转服务器；课表解析在 [`shared/cdut-parser.ts`](shared/cdut-parser.ts)，对「一格多门课」「多段周次」这类真实排版都做了处理。

## 提醒

- **待办提醒**：按已排期开始时间或截止时间发出本机通知。
- **上课提醒**：导入的课表会在每节课开始前推送「课程名 + 上课时间 + 教室 + 教师」，提前量可选 5–30 分钟。
- **静默模式**：响铃与静默是两个独立通知渠道，选静默后只显示在通知栏，不响铃也不震动；也可以只在系统通知设置里单独调这一个渠道。

提醒全部由 Android 本机排程，不需要服务器，并会随课表变化自动重排。

## 桌面小组件

<p align="center">
  <img src="docs/images/widget.png" alt="Android 桌面小组件：今天与明天课表 + 待办清单" width="400">
</p>

- 🗓️ 今天 / 明天双栏课表，含课程彩色标记、教室与时间，已结束的课自动隐去
- ☑️ 待办清单可滚动，点复选框直接完成，已完成的加删除线并沉底
- 👆 点小组件任意位置打开 App 并回到主页
- 🎨 面板底色、不透明度、明暗、背景图都能在 App 里单独设置

## 界面

<p align="center">
  <img src="docs/images/app-calendar.png" alt="日历视图：周视图与多日历" width="270">
  <img src="docs/images/app-todos.png" alt="待办管理：四象限分级" width="270">
  <img src="docs/images/app-review.png" alt="今日回顾：统计与近 7 天趋势" width="270">
</p>

> 日历里**点一下**任意课程或待办可以看详情（时间、地点、日历、教师与周次……），**长按**进入删除确认；拖动事件可改期，左右滑动翻页。

## 快速开始

**Android**：到 [Releases](https://github.com/ADA-quart/ITDC/releases/latest) 下载 APK 安装（debug 签名，适合个人使用，不适合上架应用商店）。

**Web / 桌面**

```bash
git clone https://github.com/ADA-quart/ITDC.git
cd ITDC
npm install
npm run dev          # 前端：http://localhost:5173
```

默认即为「仅本机」模式，打开就能用，不需要任何配置。

**Windows 一键脚本**：依次双击 `install.bat`、`start.bat`（后者会打印局域网 IP，方便手机填写）。

**Docker**

```bash
docker compose up -d
```

## 三种使用模式

| 模式 | 场景 | 怎么配 |
|------|------|--------|
| 仅本机（默认） | 单设备 | 不用配；数据在浏览器 IndexedDB / App 本地存储，排程与大模型调用都在本机 |
| 局域网 | 手机连电脑 | 电脑跑 `npm start`，手机在设置里填 `http://<电脑IP>:3000/api` |
| 公网 | 任意网络多设备 | 部署到服务器或内网穿透，填 `https://<域名>/api` |

切到同步模式时两端数据会**合并**：各自独有的记录都保留，同一条以修改时间较新者为准。

> ⚠️ 服务端没有账号体系，能访问到地址的人就能读写数据。公网部署前请先加访问控制，详见 [SECURITY.md](SECURITY.md)。

## 技术栈

React 18 · TypeScript · Ant Design 5 · FullCalendar 6 · Vite 6 · IndexedDB
· Express · sql.js（SQLite 的 WASM 版，免原生编译）· Capacitor 8 · Vitest

## 项目结构

```text
src/                    前端：日历、待办、排程、回顾、设置、i18n
  api/                  本地数据层、可选同步、课表 CAS 直连、通知排程
shared/                 前后端共用：课表解析、学校配置、课程配色、提示词与解析
server/                 可选同步服务：Express + sql.js（路由 / 数据库 / 排程 / LLM 代理）
plugins/itdc-widget/    Android 桌面小组件（Capacitor 本地插件，含原生布局与接收器）
android/                Capacitor Android 壳与打包配置
docs/                   架构、部署、小组件、API 文档与截图
```

## 开发

```bash
npm run dev:all      # 前端 5173 + 可选后端 3000
npx tsc --noEmit     # 类型检查
npm run test         # 单元测试（Vitest）
npm run build        # 构建前端
```

构建 Android APK（顺序不能省，只跑 gradlew 不会重新打包前端资源）：

```bash
npm run android:sync
cd android && ./gradlew assembleDebug
```

改排程规则时注意：算法在客户端与服务端各有一份实现（`src/api/local-scheduler.ts`、`server/services/scheduler.ts`），
提示词与响应解析统一收敛在 `shared/llm-prompt.ts`，两边策略要保持一致。

## 配置

纯本机模式无需任何配置；自建同步服务时复制 `.env.example` 为 `.env`。

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `3000` | 服务端口 |
| `HOST` | `0.0.0.0` | 监听地址，只允许本机可设 `127.0.0.1` |
| `DB_PATH` | `data/calendar.db` | SQLite 文件路径 |
| `CRYPTO_SECRET` | 开发默认值 | 加密服务端保存的 LLM API Key，**生产必填**（`openssl rand -hex 32`） |
| `CORS_ORIGINS` | 空 | 额外允许的前端来源，逗号分隔 |
| `CORS_ALLOW_ALL` | 空 | 设为 `1` 放行任意来源，仅供内网或自建部署 |

## 文档

| 文档 | 内容 |
|------|------|
| [架构说明](docs/ARCHITECTURE.md) | 数据流、合并同步原理、排程的双路径设计、技术选型理由 |
| [部署指南](docs/DEPLOYMENT.md) | 局域网、内网穿透、云平台、Docker |
| [小组件](docs/WIDGET.md) | 设计、数据通道、Android 平台限制 |
| [API 参考](docs/API.md) | 全部 HTTP 接口 |
| [安全说明](SECURITY.md) | 威胁模型、密钥存放、数据位置 |
| [贡献指南](CONTRIBUTING.md) | 开发约定与提交规范 |
| [变更日志](CHANGELOG.md) | 每个版本的改动 |

## 常见问题

**数据存在哪？** 仅本机模式在浏览器 IndexedDB / App 本地存储；同步模式在服务端 `data/calendar.db`。用「导出 iCal」可以随时备份。

**小组件不刷新？** 国产 ROM 默认限制后台：设置 → 应用 → ITDC → 省电策略 → 无限制。

**手机连不上电脑？** 确认在同一网络、`start.bat` 正在运行，并放行 Windows 防火墙的 3000 端口。

**课表导入失败？** 失败信息会带上真实原因与走过的步骤（含每步 HTTP 状态码），照着提示排查即可；教务系统偶发「操作过于频繁」限流，隔几分钟再试。

**教学周次对不上？** 导入时要手动填写第一周周一的日期（教务系统不提供校历），填错会让整学期偏移一周。

**排程结果不符合预期？** 算法调度会严格避开冲突并切分超长任务；如果任务本身需要语义判断，改用 LLM 调度，或在设置里调整提示词模板。

**APK 为什么是 debug 签名？** 方便个人分发与覆盖升级，不适合上架应用商店。

## 贡献

欢迎提 Issue 与 PR，开发约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。提交前请确保 `npx tsc --noEmit` 与 `npm run test` 都通过。

## 许可证

[PolyForm Noncommercial License 1.0.0](LICENSE) © 2026 ADA-quart

**个人与非商业用途免费**：个人学习、研究、实验、业余项目，以及学校、慈善机构、公共研究机构等非营利组织，都可以自由使用、修改和分发。

**商业用途需另行授权**：包括在公司内部部署、作为付费产品或服务的一部分，以及其他以商业获利为目的的使用。有需求请联系维护者。
