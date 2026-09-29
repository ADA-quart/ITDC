<div align="center">

<h1>ITDC</h1>

<h3>本地优先的日历 · 待办 · 智能排程</h3>

<p>数据存在你自己的设备上，不配服务器也能完整使用<br>
需要手机与电脑共享时，再开启同步 —— 两端数据合并，不互相覆盖</p>

<p>
  <a href="README.en.md">English</a> ·
  <b>简体中文</b> ·
  <a href="https://github.com/ADA-quart/ITDC/releases/latest">下载 APK</a>
</p>

<p>
  <a href="https://github.com/ADA-quart/ITDC/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ADA-quart/ITDC/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/ADA-quart/ITDC/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/ADA-quart/ITDC"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Web%20%7C%20Android-informational">
</p>

</div>

## 功能

- 📅&nbsp;多日历管理，自定义名称与颜色
- 🔁&nbsp;完整支持 RRULE 重复规则，可表示每周固定的课程表
- 📥&nbsp;iCal 导入导出，📤 导出本周为 Excel
- 🖱️&nbsp;拖拽移动事件、拖动边缘改时长、点空白处快速新建
- ✅&nbsp;艾森豪威尔四象限待办，自动分级 P1–P4
- ⏰&nbsp;截止日期倒计时，逾期高亮
- ✂️&nbsp;长任务自动拆分，段落之间留休息时间
- 💬&nbsp;自然语言录入：输入「周五下午交报告」自动解析成结构化待办
- 🧠&nbsp;两种排程模式：本地算法调度，或交给大模型调度
- 🌓&nbsp;浅色 / 深色 / 跟随系统
- 🌍&nbsp;简体中文 / English
- 📴&nbsp;离线可用，断网时读写不受影响

## 桌面小组件

Android 小组件不是静态截图，可以交互：

- 🗓️&nbsp;**今天 / 明天**双栏课表，含彩色标记、课程名、地点、时间
- ☑️&nbsp;待办清单可滚动，点复选框直接完成，已完成的显示删除线并沉底
- ⏳&nbsp;已结束的课程自动隐去，不用打开 App
- 🏷️&nbsp;顶栏显示最近有课所属的日历名、日期与教学周次
- 🎨&nbsp;圆角磨砂外观，跟随系统深浅色
- 📴&nbsp;纯本机模式同样可用，无需服务器

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
| 仅本机（默认） | 单设备 | 不用配 |
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
| [架构说明](docs/ARCHITECTURE.md) | 数据流、合并同步原理、技术选型理由 |
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

## 常见问题

**小组件不自动刷新** —— 国产 ROM 默认限制后台。设置 → 应用 → ITDC → 省电策略 → 无限制。

**手机连不上电脑** —— 确认同一网络、`start.bat` 在运行，检查 Windows 防火墙是否放行 3000。

**数据在哪** —— 服务端模式在 `data/calendar.db`；仅本机模式在浏览器 IndexedDB，可用「导出 iCal」备份。

**教学周次对不上** —— 目前按「9 月 1 日所在周为第 1 周」估算，与各校校历可能有差异。

**APK 为什么是 debug 签名** —— 未配置发布密钥库，个人使用没问题，不适合上架应用商店。

## 许可证

[MIT](LICENSE) © 2026 ADA-quart
