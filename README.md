# 智能日历与待办规划 (Smart Calendar Planner)

一款集成日历管理、待办规划与智能调度的全栈应用。基于 Eisenhower 四象限优先级矩阵，提供算法自动排程与 LLM 智能排程两种模式，帮助你高效规划时间。

Designed by ADA-quart

## 功能特性

### 多日历管理
- 创建、删除、切换显示多个日历，每个日历可自定义名称与颜色
- 支持 iCal (.ics) 文件导入，自动创建独立日历并批量导入事件
- 支持重复事件（RRULE 规则），完整兼容 RFC 5545

### 待办管理（Eisenhower 四象限）
- 通过紧急度与重要度（1-4 级）自动归类为四象限优先级：
  - **P1 紧急重要** - 红色标签
  - **P2 重要不紧急** - 橙色标签
  - **P3 紧急不重要** - 蓝色标签
  - **P4 普通** - 绿色标签
- 待办状态流转：待办 -> 已排程 -> 已完成
- 截止日期倒计时，逾期红色高亮
- 预估工时（分钟）、描述等完整字段

### 智能调度
- **算法调度** - 贪心策略，按优先级和截止日期排序，自动避让已有事件，遵守工作时段（7:00-23:00），每 2 小时连续工作后插入 15 分钟休息，30 天规划范围
- **LLM 调度** - 支持 OpenAI / DeepSeek / Ollama，通过自然语言理解上下文生成更智能的排程方案
- 调度前自动校验：时间冲突、深夜排班、截止日期违规
- 一键应用方案，待办自动标记为已排程并显示在日历上

### 日历交互
- 拖拽移动事件、拖拽边缘修改时长
- 点击空白区域快速创建事件
- 已排程待办以紫色事件显示在日历上，前缀 `[待办]`
- 导出本周日历为 Excel 表格（含周历视图与事件明细两个工作表）

### 安全
- LLM API 密钥使用 AES-256-GCM 加密存储
- 接口不返回 API 密钥明文

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Ant Design 5 + FullCalendar 6 |
| 后端 | Express + TypeScript + sql.js (SQLite WASM) |
| 构建 | Vite 6 |
| LLM | OpenAI / DeepSeek / Ollama |

## 环境要求

- **Node.js 18+**（推荐 LTS 版本）- [下载地址](https://nodejs.org)
- 操作系统：Windows（提供 bat 脚本），macOS / Linux 可通过命令行使用

## 快速开始

### 方式一：一键脚本（Windows 推荐）

1. 双击 `install.bat` 安装依赖（仅在项目文件夹内安装）
2. 双击 `start.bat` 启动应用

`start.bat` 会在 `node_modules` 不存在时自动安装依赖，然后依次启动后端和前端服务，并在浏览器就绪后自动打开页面。

### 方式二：命令行

```bash
# 克隆仓库
git clone https://github.com/<your-username>/smart-calendar.git
cd smart-calendar

# 安装依赖
npm install

# 配置环境变量（可选，使用默认值即可开发）
cp .env.example .env

# 启动开发服务器
npm run dev:all
```

打开浏览器访问 http://localhost:5173

## 卸载

双击 `uninstall.bat`，选择卸载模式：

| 模式 | 说明 |
|------|------|
| **Clean only** (1) | 删除依赖、构建缓存和数据库（node_modules、dist、data、package-lock.json、tsconfig.tsbuildinfo），保留源码 |
| **Full delete** (2) | 删除整个项目文件夹，包括源码和数据，不可恢复 |

- Clean only 模式仅清理项目本地文件，不会影响全局 npm 缓存
- Full delete 模式需要二次确认，脚本会先退出自身再删除文件夹，避免文件锁定

## 项目结构

```
├── .env.example               # 环境变量模板
├── .gitignore
├── LICENSE                    # MIT License
├── index.html                 # Vite 入口
├── install.bat                # 一键安装（仅安装到项目目录）
├── start.bat                  # 一键启动
├── uninstall.bat              # 一键卸载
├── package.json
├── package-lock.json
├── vite.config.ts
├── tsconfig.json
├── server/
│   ├── index.ts               # Express 服务入口
│   ├── db/
│   │   ├── index.ts           # sql.js 数据库封装
│   │   └── schema.sql         # 数据库表结构
│   ├── llm/
│   │   ├── provider.ts        # LLM 接口定义
│   │   ├── openai-compatible.ts # OpenAI / DeepSeek 兼容实现
│   │   └── ollama.ts          # Ollama 本地模型实现
│   ├── routes/
│   │   ├── calendar.ts        # 日历与事件 API + iCal 导入 + Excel 导出
│   │   ├── todo.ts            # 待办 API（含优先级自动计算）
│   │   └── schedule.ts        # 调度 API + LLM 配置管理
│   ├── services/
│   │   ├── scheduler.ts       # 算法调度引擎
│   │   ├── llm-scheduler.ts   # LLM 调度引擎
│   │   └── ical-parser.ts     # iCal 文件解析
│   └── utils/
│       └── crypto.ts          # API 密钥 AES-256-GCM 加密工具
├── src/
│   ├── main.tsx               # React 入口
│   ├── App.tsx                # 根组件（侧边栏导航）
│   ├── api/
│   │   └── client.ts          # Axios API 客户端
│   ├── types/
│   │   └── index.ts           # TypeScript 类型定义
│   ├── utils/
│   │   └── priority.ts        # 优先级计算工具
│   ├── components/
│   │   ├── CalendarView.tsx   # 日历视图
│   │   ├── TodoList.tsx       # 待办列表
│   │   ├── TodoForm.tsx       # 待办表单
│   │   ├── SchedulePanel.tsx  # 智能调度面板
│   │   ├── ImportModal.tsx    # iCal 导入弹窗
│   │   └── SettingsModal.tsx  # LLM 配置管理
│   └── custom.d.ts            # sql.js / ical.js 类型声明
├── data/                      # [运行时生成] SQLite 数据库
│   └── calendar.db
├── dist/                      # [运行时生成] 构建产物
└── node_modules/              # [运行时生成] npm 依赖
```

> 标注 `[运行时生成]` 的目录不包含在 Git 仓库中，由 `.gitignore` 忽略，在安装或运行时自动创建。

## API 接口

### 日历与事件 `/api/calendar`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/calendars` | 获取所有日历 |
| POST | `/calendars` | 创建日历 |
| DELETE | `/calendars/:id` | 删除日历及其所有事件 |
| GET | `/events` | 获取事件（支持 start/end 范围筛选） |
| POST | `/events` | 创建事件 |
| PUT | `/events/:id` | 更新事件 |
| DELETE | `/events/:id` | 删除事件 |
| POST | `/import` | 导入 iCal 文件 |
| GET | `/export-week` | 导出本周日历为 Excel (.xlsx) |

### 待办 `/api/todos`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 获取待办列表（支持 status/priority 筛选） |
| POST | `/` | 创建待办（自动计算优先级） |
| PUT | `/:id` | 更新待办 |
| DELETE | `/:id` | 删除待办 |

### 调度 `/api/schedule`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/generate` | 生成调度方案（algorithm / llm） |
| POST | `/apply` | 应用调度方案 |
| GET | `/llm-config` | 获取 LLM 配置（不含 API Key） |
| POST | `/llm-config` | 创建 LLM 配置 |
| PUT | `/llm-config/:id/activate` | 激活配置 |
| DELETE | `/llm-config/:id` | 删除配置 |

## 配置

### 环境变量

复制 `.env.example` 为 `.env` 并按需修改：

```bash
cp .env.example .env
```

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 后端服务端口 | `3000` |
| `CRYPTO_SECRET` | API 密钥加密密钥 | `smart-calendar-default-secret-key` |

> ⚠️ 生产环境请务必通过环境变量 `CRYPTO_SECRET` 设置强密钥，不要使用默认值。

### 端口

| 服务 | 端口 |
|------|------|
| 前端 (Vite 开发服务器) | 5173 |
| 后端 (Express API) | 3000 |

### 数据库

- 引擎：sql.js（SQLite WASM，无需原生编译，无需系统安装 SQLite）
- 文件：`data/calendar.db`（首次运行自动创建）
- 自动保存：每 5 秒 + 关闭时
- 写入策略：原子写入（临时文件 + 重命名）

### LLM 提供商

| 提供商 | 默认模型 | 说明 |
|--------|----------|------|
| OpenAI | gpt-4o-mini | 需要 API Key |
| DeepSeek | deepseek-chat | 需要 API Key |
| Ollama | llama3 | 本地运行，无需 Key |

## 生产部署

```bash
npm run build        # 构建前端到 dist/
npm start            # 启动服务（同时提供 API 和前端静态文件）
```

生产模式下 Express 自动托管 `dist/` 目录，单进程即可在端口 3000 提供完整服务。

## NPM 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动前端开发服务器 |
| `npm run dev:server` | 启动后端开发服务器（热重载） |
| `npm run dev:all` | 同时启动前后端开发服务器 |
| `npm run build` | 构建前端生产版本 |
| `npm start` | 生产模式启动 |

## License

[MIT](LICENSE) © ADA-quart
