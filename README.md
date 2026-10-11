<p align="center"><img src="public/icons/icon-512.png" width="88" alt="日日新"></p>

<h1 align="center">日日新 · ITDC</h1>

<p align="center">
  <b>成都理工大学课表 + 智能待办</b> · Android App / 浏览器（PWA）<br>
  教务课表直连导入 · 上课提醒 · 桌面小组件 · 四象限待办 · 算法 / 大模型排程
</p>

<p align="center">
  <a href="https://github.com/ADA-quart/ITDC/releases/latest"><img src="https://img.shields.io/github/v/release/ADA-quart/ITDC?label=release&color=1677FF" alt="release"></a>
  <a href="https://github.com/ADA-quart/ITDC/actions/workflows/android-apk.yml"><img src="https://github.com/ADA-quart/ITDC/actions/workflows/android-apk.yml/badge.svg" alt="Android APK"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-8957e5" alt="license"></a>
  <img src="https://img.shields.io/badge/platform-Android%207.0%2B%20%7C%20Web-3DDC84?logo=android&logoColor=white" alt="platform">
  <a href="https://github.com/ADA-quart/ITDC/releases"><img src="https://img.shields.io/github/downloads/ADA-quart/ITDC/total" alt="downloads"></a>
</p>

<p align="center">
  <img src="docs/images/app-glass.png" width="23%" alt="液态玻璃外观">
  <img src="docs/images/app-timetable.png" width="23%" alt="课表视图">
  <img src="docs/images/app-calendar.png" width="23%" alt="今日安排">
  <img src="docs/images/app-todos.png" width="23%" alt="待办管理">
</p>

<p align="center"><sub>截图为 Android 模拟器实测，数据为示例数据</sub></p>

<p align="center"><b>简体中文</b> | <a href="README.en.md">English</a></p>

## 这是什么

日日新（ITDC）把**课表**和**待办**放在同一个应用里。

用学校统一认证登录后，本学期课表会自动导入并保持更新。每节课开始前有提醒，桌面上有小组件；待办按四象限整理，排不完的事可以交给本地算法或大模型，安排进课表的空隙。

- **本地优先**：数据默认只保存在本机，断网可用，不需要服务器。
- **教务直连**：导入课表时，App 直接与学校统一认证、教务系统通信，不经过第三方中转。
- **同步可选**：想让手机和电脑共用一份数据时，再自建同步服务，见 [部署指南](docs/DEPLOYMENT.md)。
- **非官方作品**：由学生开发维护，与成都理工大学官方无关。

## 功能

### 📚 课表

- **导入教务课表**：在 App 内完成统一认证登录，选择学期，即可把个人课表导入为日历事件。账号密码可以记住，密码经 Android Keystore 加密后只存本机。
- **自动周次**：教务系统不提供开学日期，导入时填写一次第一周周一，之后自动推算周次。
- **保持最新**：每天首次打开 App 时静默更新课表，也可以手动更新。
- **三种视图**：日视图、周视图、课表网格，支持左右滑动翻页、翻周。
- **课程配色**：内置 18 色明亮色板，同一门课颜色固定，不同课程尽量不撞色，也支持单门课自定义颜色。
- **上课提醒**：每节课开始前推送课程名、教室与时间；提前量默认 10 分钟，可调整，也可设为静默提醒。

### ✅ 待办

- **四象限**：按紧急、重要两个维度自动分入四个象限，点开象限卡片即可查看对应待办。
- **自然语言添加**：输入「周五下午前交周报」就能新建待办；配置了大模型就交给大模型理解，没有配置则使用内置离线规则。
- **图片识别**：课件截图、通知栏截图可以直接导入，提取其中的待办；默认走多模态大模型，也可以下载离线 OCR 模型，断网时兜底。
- **课内可做**：标记「上课时也能做」的待办，允许被排进课堂时间，适合水课与自习。
- **拆分时段**：大块任务可以拆成多个时间片，支持自动拆分与手动拆分。
- **待办提醒**：按已排时间或截止时间提前推送通知，提前量可调。

### 🧠 智能规划

- **算法调度**：完全在本地运行，不依赖模型；把待办排进课表空隙，自动避开上课、午休与深夜。
- **LLM 调度**：可接入 DeepSeek、OpenAI、Ollama 等 OpenAI 兼容服务，由大模型按你的偏好安排。本机模式下，API Key 保存在系统密钥库中。
- **冲突校验**：每份方案都会经过一轮冲突检查，排不下或拆分不完整的问题会明确列出。
- **与课程融合**：排进某节课的课内待办，会出现在这节课的详情中，课表上也带角标提示。

### 📈 回顾

- **今日**：逾期、今日到期、待处理、已完成四个指标；近 7 天新建与完成趋势；四象限分布。
- **本周**：本周上了多少节课、完成了多少待办、连续记录几周、每天完成情况、与上周的对比，以及一句随机语气的周评。

### 🧩 桌面小组件（Android）

- **两种尺寸**：标准 4×2 与小尺寸 2×2，共用同一份数据，随桌面尺寸自适应；方形小尺寸会自动精简为「今天」单列。
- **课表与待办**：今天、明天双栏课表加待办清单，三个区域都能上下滑动，上完的课自动消失。
- **桌面打勾**：待办可以直接在桌面上勾选，回到 App 自动写回。
- **独立外观**：面板颜色、不透明度、明暗、背景图（支持预模糊）都可以单独设置，也能一键恢复默认。

### 🎨 个性化

- **主题色**：11 个预设（含洛天依蓝、初音未来绿、永雏塔菲粉、奶龙黄），按钮、选中态与小组件共用。
- **背景图**：焦点、缩放、模糊，以及壁纸层与面板层的不透明度都可以单独调整；App 与小组件共用同一张图。
- **液态玻璃**：更强的模糊、饱和度与内高光，让卡片和底栏呈现玻璃质感。
- **明暗模式**：浅色、深色、跟随系统；课程块文字提供石墨灰、白、黑三档。
- **多端布局**：手机、横屏、平板三档自适应。

### 💾 数据与同步

- **本地优先**：默认情况下，所有数据只保存在本机。
- **导入导出**：支持 iCal 导入/导出与导出本周（Excel）。
- **跨设备同步（可选）**：自托管一个 Node + SQLite 服务，手机与电脑填写同一地址即可共用数据。
- **开源许可页**：App 内置第三方开源许可清单，与仓库中的 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) 同步。

## 截图

<p align="center">
  <img src="docs/images/widget.png" width="46%" alt="桌面小组件">
  <img src="docs/images/app-schedule.png" width="23%" alt="智能规划">
  <img src="docs/images/app-review.png" width="23%" alt="本周回顾">
</p>

<p align="center">
  <img src="docs/images/app-review-today.png" width="23%" alt="今日回顾与四象限">
  <img src="docs/images/app-appearance.png" width="23%" alt="外观设置">
  <img src="docs/images/app-import.png" width="23%" alt="导入教务课表">
</p>

## 下载与安装

Android 安装包在 [Releases](https://github.com/ADA-quart/ITDC/releases/latest) 页面下载（文件名 `itdc-vX.Y.Z.apk`，支持 Android 7.0 及以上）。

- APK 使用 **debug 签名**，适合个人使用与测试，请勿上架应用商店。
- 首次安装需允许「未知来源」；后续版本可直接覆盖升级，本地数据会保留。
- 小组件不刷新时，请到「设置 → 应用 → 日日新 → 省电策略」改为**无限制**；澎湃 OS、MIUI 等国产系统默认限制后台。
- Web 版可直接用 Chrome / Edge 打开部署好的地址，功能与 App 基本一致；通知、小组件与系统密钥库为 Android 独有。

## 从源码构建

环境：Node.js 22+、JDK 21、Android SDK（platform 36 / build-tools 36）。

```bash
npm install
npm run dev                 # 浏览器里跑 Web 版（http://localhost:5173）

npm run android:sync        # 构建 Web 产物并同步进 Android 工程
cd android
./gradlew assembleDebug     # 产出 app/build/outputs/apk/debug/app-debug.apk
```

本地 debug 包使用独立包名（`io.github.adaquart.itdc.debug`，桌面名称为「ITDC Debug」），可与正式版共存。推送 `v*` tag 后，GitHub Actions 会自动构建 APK 并发布 Release。

## 项目结构

| 目录 | 说明 |
| --- | --- |
| `src/` | React 前端：日历、待办、智能规划、回顾、设置等界面，以及 `api/` 中的数据与业务逻辑 |
| `shared/` | 前后端共享：教务课表解析（`cdut-parser`）、课程配色、iCal 处理 |
| `server/` | 可选的同步服务器（Express + SQLite），不部署也不影响本机使用 |
| `plugins/itdc-widget/` | Android 原生插件：桌面小组件、通知排程、系统密钥库 |
| `android/` | Capacitor Android 工程 |
| `docs/` | [架构](docs/ARCHITECTURE.md)、[API](docs/API.md)、[部署与同步](docs/DEPLOYMENT.md)、[小组件设计](docs/WIDGET.md) |

技术栈：React + TypeScript + Vite + Ant Design + FullCalendar；Capacitor 8（Android）；IndexedDB 本地优先存储；可选 Express + SQLite 同步服务；离线 OCR 使用 PP-OCRv4（onnxruntime-web）。

## 文档

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 架构与数据流
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — 自托管部署与跨网络同步
- [docs/API.md](docs/API.md) — 服务端接口
- [docs/WIDGET.md](docs/WIDGET.md) — 小组件的设计取舍与踩过的坑
- [CHANGELOG.md](CHANGELOG.md) — 每个版本的改动
- [CONTRIBUTING.md](CONTRIBUTING.md) / [SECURITY.md](SECURITY.md)

## 常见问题

**导入课表显示 0 门课？**
教务系统在开学前、寒暑假期间经常还没发布新学期课表，返回空是正常的。等教务更新后点「更新教务课表」即可；也请确认学期与第一周周一的日期填写正确。

**数据会上传到哪？**
默认不上传：课表、待办都保存在本机。只有配置了大模型服务时，相关文本才会发送给该服务；只有开启跨设备同步时，数据才会同步到你自己部署的服务器。账号密码保存在 Android 系统密钥库中，取消「记住账号密码」会立即删除。

**只有成都理工大学能用吗？**
课表导入目前只适配了成都理工大学教务系统；日历、待办、智能规划、小组件等功能不依赖学校。

**为什么用 debug 签名发布？**
方便个人使用与测试；如需上架应用商店，请自行配置 release 签名。

**支持 iOS 吗？**
暂不支持，目前重点在 Android 与 Web。

## 许可与声明

- 代码以 [PolyForm Noncommercial License 1.0.0](LICENSE) 发布：**可以自由使用、修改、分发，但不可用于商业用途**。Required Notice: Copyright 2026 ADA-Quart & TyTs
- 本项目是**非官方**学生作品，与成都理工大学无任何隶属关系；教务系统数据版权归学校所有，请遵守学校的使用规定
- **名称说明**：「日日新」取自《礼记·大学》「苟日新，日日新，又日新」，与商汤科技及其「日日新」（SenseNova）大模型**没有任何关系**；本项目不代表、不隶属于商汤科技，也未使用其模型或服务
- 第三方开源依赖的许可清单见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)

## 致谢

- **特别感谢 [kengwang/CDUniTap](https://github.com/kengwang/CDUniTap)**：本项目「统一认证（CAS）登录 + 教务课表抓取」的接口与流程设计参考了这个项目——仅作设计参考，未分发其代码，课表解析为本项目自有实现
- 也感谢所有开源项目的作者：React、Capacitor、Ant Design、FullCalendar、onnxruntime-web、PaddleOCR / PP-OCR、sql.js、ical.js 等（完整清单见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)）

<p align="center"><sub>苟日新，日日新，又日新。</sub></p>
