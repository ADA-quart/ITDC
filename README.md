<div align="center">

<h1>ITDC</h1>

<h3>本地优先的日历 · 待办 · <b>智能排程</b></h3>

<p>把待办交给算法或大模型，自动排进日历空档<br>
数据存在你自己的设备上，不配服务器也能完整使用</p>

<p>
  <a href="README.en.md">English</a> ·
  <b>简体中文</b> ·
  <a href="https://github.com/ADA-quart/ITDC/releases/latest">下载 APK</a>
</p>

<p>
  <a href="https://github.com/ADA-quart/ITDC/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ADA-quart/ITDC/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/ADA-quart/ITDC/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/ADA-quart/ITDC"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-orange.svg"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Web%20%7C%20Android-informational">
</p>

<img src="docs/images/app-schedule.png" alt="ITDC 智能排程：待办自动排入日历空档" width="880">

</div>

## 智能排程

ITDC 的核心是**把待办自动排进你的时间表**。点一下「生成方案」，引擎会读取全部未完成待办与
现有日程，避开已占用的时段，按优先级和截止时间排出可执行的计划，确认后再写入日历。

**两种调度模式**

| 模式 | 怎么排 | 适合 |
|------|--------|------|
| ⚡ 算法调度 | 本地确定性算法，不联网、瞬时出结果 | 日常固定节奏，想要可预期、可复现的排法 |
| 🧠 LLM 调度 | 交给大模型理解任务语义与偏好 | 任务描述复杂、需要模型判断拆分方式的场景 |

**算法调度怎么排**

- 按四象限优先级排序：紧急重要 → 重要不紧急 → 紧急不重要 → 普通
- 同一优先级内，截止时间早的先排
- 只使用每天 7:00–23:00 的工作时段，避开已有日程与已排期的待办
- 单段最长 90 分钟，超长任务自动切分并插入休息；每连续工作 2 小时留 15 分钟休息
- 排完自动校验：时段冲突、超出工作时段、越过截止时间、已过去的时间段，都会列出来

**LLM 调度怎么排**

- **仅本机模式也能直连大模型**：由 App 自己组装提示词、直接调用服务商，不经过中转服务器
- API Key 用 **Android Keystore** 加密保存在本机（浏览器版明文存本地，设置页会明确提示）
- 支持 OpenAI、DeepSeek、Ollama、LM Studio 与自定义 OpenAI 兼容端点
- 提示词可自定义：设置里能改调度模板，控制模型如何理解和拆分你的任务
- 模型返回后同样走本地校验，不合格的安排会标出来而不是直接写入

**结果可以再调**

排定后待办会出现在日历里，可以直接拖拽改时间、拖边缘改时长，调整立即生效。

> 排程逻辑在客户端与服务端各有一份实现（`src/api/local-scheduler.ts`、`server/services/scheduler.ts`），
> 两边策略一致；提示词与响应解析统一收敛在 `shared/llm-prompt.ts`，两种模式不会排出两套结果。

## 功能

- 🧠&nbsp;**智能排程：算法调度或大模型调度，把待办自动排进日历空档**（见上节）
- ✅&nbsp;艾森豪威尔四象限待办，自动分级 P1–P4
- ✂️&nbsp;长任务自动拆分，段落之间留休息时间
- 💬&nbsp;自然语言录入：输入「周五下午交报告」自动解析成结构化待办
- 📅&nbsp;多日历管理，自定义名称与颜色
- 🔁&nbsp;完整支持 RRULE 重复规则，可表示每周固定的课程表
- 🖱️&nbsp;拖拽移动事件、拖动边缘改时长、点空白处快速新建
- 📥&nbsp;iCal 导入导出，📤 导出本周为 Excel
- 🎓&nbsp;教务课表导入：用学校统一认证（CAS）账号登录，按学期整表导入为日历事件；原生 App 直连学校系统，不依赖中转服务器
- ⏰&nbsp;截止日期倒计时，逾期高亮
- 🔔&nbsp;到点提醒：Android 端按待办的排程开始或截止时间弹出系统通知
- 📊&nbsp;今日回顾：逾期、今日到期、待处理与已完成统计，含近 7 天趋势
- 🌓&nbsp;浅色 / 深色 / 跟随系统
- 🎨&nbsp;外观自定义：主题色、背景图、小组件配色
- 🌍&nbsp;简体中文 / English
- 📴&nbsp;离线可用，断网时读写不受影响
- ⬆️&nbsp;检查更新：设置里手动查询新版本，只提示、不自动下载

## 界面

<p align="center">
  <img src="docs/images/app-calendar.png" alt="日历视图" width="440">
  <img src="docs/images/app-todos.png" alt="待办管理：四象限分级" width="440">
</p>
<p align="center">
  <img src="docs/images/app-review.png" alt="今日回顾：统计与趋势" width="440">
</p>

## 桌面小组件

Android 小组件不是静态截图，可以交互：

<p align="center">
  <img src="docs/images/widget.png" alt="Android 桌面小组件" width="400">
</p>

- 🗓️&nbsp;**今天 / 明天**双栏课表，含彩色标记、课程名、地点、时间
- ☑️&nbsp;待办清单可滚动，点复选框直接完成，已完成的显示删除线并沉底
- ⏳&nbsp;已结束的课程自动隐去，不用打开 App
- 🏷️&nbsp;顶栏显示最近有课所属的日历名、日期与教学周次
- 🎨&nbsp;圆角磨砂外观，跟随系统深浅色
- 🖌️&nbsp;面板底色、不透明度、明暗与背景图都能在 App 里改，保存后立即生效
- 📴&nbsp;纯本机模式同样可用，无需服务器

外观在 **设置 → 外观** 里调整：主题色可选预设或取色器自定义；背景图支持上传本地图片，
并单独调节不透明度与模糊；小组件可以跟随应用配色，也可以单独指定底色与明暗，
面板不透明度调到 0 就是纯文字挂件。

## 快速开始

**Android** —— 从 [Releases](https://github.com/ADA-quart/ITDC/releases/latest) 下载 APK 安装。

**Web / 桌面**

```bash
git clone https://github.com/ADA-quart/ITDC.git
cd ITDC
npm install
npm run dev:all          # 前端 5173 + 后端 3000
```

打开 http://localhost:5173 。默认即为「仅本机」模式，不需要任何配置。

**Windows** —— 依次双击 `install.bat` 与 `start.bat`，后者会打印局域网 IP 方便手机连接。

## 三种使用模式

| 模式 | 场景 | 怎么配 |
|------|------|--------|
| 仅本机（默认） | 单设备 | 不用配，排程与大模型调用都在本机完成 |
| 局域网 | 手机连电脑 | 电脑跑 `npm start`，手机填 `http://<电脑IP>:3000/api` |
| 公网 | 任意网络多设备 | 部署到云平台或内网穿透，填 `https://<域名>/api` |

切换到同步模式时两端数据会**合并**：各自独有的记录都保留，同一条以修改时间较新者为准。

> ⚠️ 服务端没有账号体系，能访问到地址的人都能读写数据。公网部署前请先加访问控制，
> 详见 [SECURITY.md](SECURITY.md)。

## 技术栈

React 18 · TypeScript · Ant Design 5 · FullCalendar 6 · Vite 6 · IndexedDB
· Express · sql.js（SQLite 的 WASM 版，无需原生编译）· Capacitor 8

## 文档

| 文档 | 内容 |
|------|------|
| [架构说明](docs/ARCHITECTURE.md) | 数据流、合并同步原理、排程的双路径设计、技术选型理由 |
| [部署指南](docs/DEPLOYMENT.md) | 局域网、内网穿透、云平台、Docker |
| [小组件](docs/WIDGET.md) | 设计、数据通道、Android 平台限制 |
| [API 参考](docs/API.md) | 全部 HTTP 接口 |
| [安全说明](SECURITY.md) | 威胁模型、密钥、数据位置 |
| [变更日志](CHANGELOG.md) | 版本历史 |
| [贡献指南](CONTRIBUTING.md) | 开发约定 |

> 目前文档为中文。英文版 README 在 [README.en.md](README.en.md)。

## 配置

复制 `.env.example` 为 `.env`（纯本机模式不需要）。

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `3000` | 服务端口 |
| `HOST` | `0.0.0.0` | 监听地址，只允许本机可设 `127.0.0.1` |
| `DB_PATH` | `data/calendar.db` | SQLite 文件路径 |
| `CRYPTO_SECRET` | 开发默认值 | 加密 LLM API Key。**生产必填**，`openssl rand -hex 32` |
| `CORS_ORIGINS` | 空 | 额外允许的前端来源，逗号分隔 |
| `CORS_ALLOW_ALL` | 空 | 设为 `1` 时放行任意来源，仅供内网或自建部署 |

## 开发

```bash
npm run dev:all         # 开发模式
npx tsc --noEmit        # 类型检查
npx vitest run          # 单元测试
npm run build           # 构建前端
```

构建 APK（顺序不能省，只跑 `gradlew` 不会重新打包前端资源）：

```bash
npm run android:sync
cd android && ./gradlew assembleDebug
```

排程算法的单元测试在 `src/api/local-scheduler.test.ts` 与 `server/services/scheduler.test.ts`，
改排程规则时两边都要跑。

## 常见问题

**小组件不自动刷新** —— 国产 ROM 默认限制后台。设置 → 应用 → ITDC → 省电策略 → 无限制。

**手机连不上电脑** —— 确认同一网络、`start.bat` 在运行，检查 Windows 防火墙是否放行 3000。

**数据在哪** —— 服务端模式在 `data/calendar.db`；仅本机模式在浏览器 IndexedDB，可用「导出 iCal」备份。

**排程结果不符合预期** —— 算法调度会严格避开已占用时段并把超长任务切段；如果任务描述本身
需要语义判断（比如「先做简单的再做难的」），改用 LLM 调度，或在设置里调整提示词模板。

**怎么导入学校课表** —— 在「设置 → 通用设置」里选定学校后，日历侧栏会出现「导入教务课表」。用学校统一认证（CAS）的账号密码登录，选择学期并填写第一周周一的日期，即可把整学期课表导入为一个新日历。目前内置成都理工大学；学校配置集中在 `shared/schools.ts`，扩展新学校时从这里开始。

**教学周次对不上** —— 目前按「9 月 1 日所在周为第 1 周」估算，与各校校历可能有差异。

**APK 为什么是 debug 签名** —— 未配置发布密钥库，个人使用没问题，不适合上架应用商店。

## 许可证

[PolyForm Noncommercial License 1.0.0](LICENSE) © 2026 ADA-quart

**个人使用与非商业用途免费**：个人学习、研究、实验、业余项目，以及学校、慈善机构、
公共研究机构等非营利组织，都可以自由使用、修改和分发。

**商业用途需另行授权**：包括但不限于在公司内部部署、作为付费产品或服务的一部分、
以及其他以商业获利为目的的使用。有商业授权需求请联系维护者。
