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

<p align="center"><sub>截图来自 Android 模拟器实测（示例数据）</sub></p>

<p align="center"><b>简体中文</b> | <a href="README.en.md">English</a></p>

## 这是什么

日日新（ITDC）把**课表**和**待办**合成一个应用：登录学校统一认证导入本学期课表 → 每天自动保持最新 → 上课前提醒、桌面小组件随时看 → 待办按四象限管理 → 让纯算法或大模型把你排不完的事塞进课表空隙里。

几个特点：

- **本地优先**：数据放在本机（IndexedDB），断网、没有服务器都是正常状态，装完就能用
- **教务直连**：App 内直接和学校统一认证（CAS）与教务系统通信，不经过任何第三方中转
- **可选跨设备同步**：想要手机和电脑共用一份数据时，再自建一个 Node 服务（见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)）
- **非官方作品**：由学生开发维护，与成都理工大学官方无关

## 功能

### 📚 课表

- **导入教务课表**：统一认证登录（支持记住账号，密码用 Android Keystore 加密、只存本机）→ 选择学期 → 拉取个人课表并展开成日历事件。教务不提供开学日期，导入时填一次「第一周周一」，之后自动算周次
- **每天自动同步**：每天第一次打开 App 时静默更新课表，也可以手动点「更新教务课表」
- **三种视图**：日 / 周 / 课表（大节课表网格），左右滑动无缝翻页翻周
- **课程配色**：内置 18 色明亮色板，同一门课永远同色、不同课尽量不撞色；也可以给单门课自定义颜色，课程块字色有石墨灰 / 白 / 黑三档
- **上课提醒**：每节课开始前推送课程名、教室和时间（提前量默认 10 分钟，可调），可开静默提醒

### ✅ 待办

- **四象限**：按「紧急 / 重要」自动落在 P1–P4，四象限卡片可以直接点进去看对应待办
- **自然语言添加**：输入「周五下午前交周报」就能生成待办——配置了大模型就交给大模型理解，没有配置则用内置离线规则解析
- **截图 / 照片识别**：课件截图、通知栏截图直接丢进来提取待办；多模态大模型直读，也能下载离线 OCR（PP-OCRv4，跑在 onnxruntime-web 上）在断网时兜底
- **课内可做**：标记「可以在上课时做」的待办，会被允许排进课堂时间（适合水课、自习）
- **拆分时段**：大块任务可以拆成多个时间片，支持智能拆分与手动拆分
- **待办提醒**：按「已排时间 / 截止时间」提前推送通知，提前量可调

### 🧠 智能规划

- **算法调度**：纯本地运行，不依赖任何模型——把待办排进课表空隙，自动避开上课、午休与深夜
- **LLM 调度**：接 DeepSeek / OpenAI / Ollama 等 OpenAI 兼容服务，让大模型理解你的偏好来排（本机模式下 API Key 用系统密钥库保管）
- **排完即校验**：每份方案都会过一遍冲突校验，排不下、拆分不完整的问题会明确列出来
- **融进课程**：课内可做的待办排进某节课后，会直接出现在这节课的详情里，课表上有角标提示

### 📈 回顾

- **今日**：逾期 / 今日到期 / 待处理 / 已完成四个指标 + 近 7 天新建与完成趋势 + 四象限分布
- **本周**：上了多少节课、完成多少条待办、连续记录多少周、每天完成情况、与上周对比，以及一句随机语气的周评

### 🧩 桌面小组件（Android）

- **两种尺寸**：标准 4×2 与 2×2 小尺寸，同一份数据两套布局，随桌面拉伸自适应
- 今天 + 明天双栏课表、待办清单，三块区域都能上下滑动，上完的课自动消失
- 在桌面上**直接打勾**完成待办，回到 App 自动写回
- 外观独立设置：面板色、不透明度、明暗、背景图（支持预模糊），可一键恢复默认

### 🎨 个性化

- **主题色**：11 个预设（含洛天依蓝、初音未来绿、永雏塔菲粉、奶龙黄），全局按钮、选中态与小组件共用
- **背景图**：焦点、缩放、模糊、壁纸层 / 面板层不透明度分别可调，App 与小组件共用同一张图
- **液态玻璃**：更强的模糊 + 饱和度 + 内高光，卡片与底栏像玻璃
- **明暗**：浅色 / 深色 / 跟随系统；课程块字色三档
- **多端布局**：手机、横屏、平板三档自适应

### 💾 数据与同步

- **本地优先**：默认全部数据只在本机
- **导入导出**：iCal 导入 / 导出、导出本周（Excel）
- **跨设备同步（可选）**：部署一个自托管的 Node + SQLite 服务，手机与电脑填同一个地址即可共用数据
- **开源许可页**：App 内置第三方开源许可清单（与仓库里的 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) 同步）

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

Android 安装包在 [Releases](https://github.com/ADA-quart/ITDC/releases/latest) 页面下载（`itdc-vX.Y.Z.apk`，Android 7.0 及以上）。

- APK 使用 **debug 签名**，适合个人使用与测试，请勿上架应用商店
- 首次安装需要允许「未知来源」；后续版本可以直接覆盖升级，本地数据保留
- **小组件不刷新**时，去「设置 → 应用 → 日日新 → 省电策略」改成**无限制**（澎湃 OS / MIUI 等国产 ROM 默认限制后台）
- 浏览器（Chrome / Edge）打开部署好的地址即可使用 Web 版，功能与 App 基本一致（通知、小组件、系统密钥库为 Android 独有）

## 从源码构建

环境：Node.js 22+、JDK 21、Android SDK（platform 36 / build-tools 36）。

```bash
npm install
npm run dev                 # 浏览器里跑 Web 版（http://localhost:5173）

npm run android:sync        # 构建 Web 产物并同步进 Android 工程
cd android
./gradlew assembleDebug     # 产出 app/build/outputs/apk/debug/app-debug.apk
```

本地 debug 包使用独立包名（`io.github.adaquart.itdc.debug`，桌面显示为「ITDC Debug」），可以和正式版共存。推送 `v*` tag 时 GitHub Actions 会自动构建 APK 并发 Release。

## 项目结构

| 目录 | 说明 |
| --- | --- |
| `src/` | React 前端：日历、待办、智能规划、回顾、设置（`components/`），数据与业务逻辑（`api/`），主题与外观（`contexts/`） |
| `shared/` | 前后端共享：教务课表解析（`cdut-parser`）、课程配色、iCal 等 |
| `server/` | 可选的同步服务器（Express + SQLite），不部署也不影响本机使用 |
| `plugins/itdc-widget/` | Android 原生插件：桌面小组件（含两个尺寸条目）、通知排程、密钥库 |
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
教务系统在寒暑假、开学前经常还没发布新学期课表，返回空是正常的；等教务更新后再点「更新教务课表」即可。另外记得选对学期、填对第一周周一的日期。

**数据会上传到哪？**
默认不上传。课表、待办都存在本机 IndexedDB；只有你自己配置了大模型服务时，相关文本才会发给你配置的那个模型服务；只有你开启跨设备同步时，数据才会同步到你自己的服务器。账号密码保存在 Android 系统密钥库，取消「记住账号密码」会立即删除。

**只有成都理工大学能用吗？**
课表导入目前适配成都理工大学教务系统；日历、待办、智能规划、小组件等其它功能不依赖学校。

**为什么用 debug 签名发布？**
方便个人使用与测试。若要上架应用商店请自行配置 release 签名。

**支持 iOS 吗？**
暂不支持，当前重点在 Android 与 Web。

## 许可与声明

- 代码以 [PolyForm Noncommercial License 1.0.0](LICENSE) 发布：**可以自由使用、修改、分发，但不可用于商业用途**。Required Notice: Copyright 2026 ADA-Quart & TyTs
- 本项目是**非官方**学生作品，与成都理工大学无任何隶属关系；教务系统数据版权归学校所有，请遵守学校的使用规定
- 第三方开源依赖的许可清单见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)

## 致谢

感谢所有开源项目的作者：React、Capacitor、Ant Design、FullCalendar、onnxruntime-web、PaddleOCR / PP-OCR、sql.js、ical.js 等（完整清单见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)）。

<p align="center"><sub>苟日新，日日新，又日新。</sub></p>
