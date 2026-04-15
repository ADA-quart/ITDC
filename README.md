<p align="center">
  <h1 align="center">📅 Smart Calendar Planner</h1>
  <p align="center">
    <em>智能日历与待办规划 — Integrated Calendar, Todo & AI-Powered Scheduling</em>
  </p>
  <p align="center">
    <a href="https://github.com/ADA-quart/Intelligent-To-Do-Calendar/blob/main/LICENSE">
      <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg">
    </a>
    <img alt="Node.js >=18" src="https://img.shields.io/badge/node-%3E%3D18-green.svg">
    <img alt="React 18" src="https://img.shields.io/badge/react-18-61dafb.svg">
    <img alt="Express" src="https://img.shields.io/badge/express-4-000000.svg">
    <img alt="Vite 6" src="https://img.shields.io/badge/vite-6-646cff.svg">
  </p>
</p>

---

A full-stack calendar and task management application built on the **Eisenhower Priority Matrix**. It offers both algorithm-based and LLM-powered intelligent scheduling to help you plan your time efficiently.

[中文文档](#中文说明)

---

## ✨ Features

### 📆 Multi-Calendar Management
- Create, delete, and toggle multiple calendars with custom names & colors
- Import iCal (`.ics`) files — auto-creates a dedicated calendar and batch-imports events
- Full RRULE (RFC 5545) support for recurring events

### ✅ Todo Management (Eisenhower Matrix)
- Automatic priority classification by urgency & importance (1–4 scale):
  - **P1 Urgent & Important** — Red
  - **P2 Important** — Orange
  - **P3 Urgent** — Blue
  - **P4 Normal** — Green
- Status flow: Todo → Scheduled → Done
- Deadline countdown with overdue highlighting
- Estimated duration, description, and full metadata

### 🧠 Intelligent Scheduling
- **Algorithm Scheduler** — Greedy strategy ordered by priority & deadline; avoids existing events; respects work hours (7:00–23:00); inserts 15-min breaks every 2 hours; 30-day planning horizon
- **LLM Scheduler** — Supports OpenAI / DeepSeek / Ollama / LM Studio / custom providers; generates context-aware schedules via natural language
- **Smart Splitting** — Tasks > 90 min are auto-split with breaks; labeled `(1/N)`, `(2/N)`, etc.; produces independent todo records when applied
- Pre-schedule validation: time conflicts, late-night shifts, deadline violations
- One-click apply — auto-marks todos as scheduled and displays on calendar
- Customizable LLM prompt templates for fine-tuning scheduling strategy

### 🌙 Dark Mode
- Light / Dark / System theme options
- Full component-level dark mode support

### 🌍 Internationalization
- Chinese / English switch
- Calendar locale auto-adjusts with language

### 🖱️ Calendar Interactions
- Drag to move events; drag edges to resize
- Click empty area to quick-create an event
- Scheduled todos shown with `[Todo]` prefix and custom color
- Export weekly calendar to Excel (week view + event detail sheets)

### 🔒 Security
- LLM API keys stored with AES-256-GCM encryption
- API never returns key plaintext

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 · TypeScript · Ant Design 5 · FullCalendar 6 |
| Backend | Express · TypeScript · sql.js (SQLite WASM) |
| Build | Vite 6 |
| LLM | OpenAI / DeepSeek / Ollama |

---

## 📋 Prerequisites

- **Node.js ≥ 18** (LTS recommended) — [Download](https://nodejs.org)
- OS: Windows (batch scripts provided); macOS / Linux work via CLI

---

## 🚀 Quick Start

### Option 1: One-Click Scripts (Windows)

1. Double-click `install.bat` to install dependencies
2. Double-click `start.bat` to launch the app

> `start.bat` auto-installs dependencies if `node_modules` is missing, starts backend & frontend, and opens the browser when ready.

### Option 2: Command Line

```bash
# Clone the repository
git clone https://github.com/ADA-quart/Intelligent-To-Do-Calendar.git
cd Intelligent-To-Do-Calendar

# Install dependencies
npm install

# (Optional) Configure environment
cp .env.example .env

# Start dev servers
npm run dev:all
```

Open http://localhost:5173 in your browser.

---

## 📁 Project Structure

```
├── .env.example               # Environment variable template
├── index.html                 # Vite HTML entry
├── install.bat                # One-click install (Windows)
├── start.bat                  # One-click start (Windows)
├── uninstall.bat              # One-click uninstall (Windows)
├── package.json
├── vite.config.ts
├── tsconfig.json
├── server/
│   ├── index.ts               # Express server entry
│   ├── db/
│   │   ├── index.ts           # sql.js database wrapper
│   │   └── schema.sql         # Database schema
│   ├── llm/
│   │   ├── provider.ts        # LLM interface definition
│   │   ├── openai-compatible.ts # OpenAI / DeepSeek implementation
│   │   └── ollama.ts          # Ollama / LM Studio implementation
│   ├── routes/
│   │   ├── calendar.ts        # Calendar & event API + iCal import + Excel export
│   │   ├── todo.ts            # Todo API (auto priority)
│   │   ├── schedule.ts        # Schedule API + LLM config
│   │   └── settings.ts        # App settings API
│   ├── services/
│   │   ├── scheduler.ts       # Algorithm scheduling engine
│   │   ├── llm-scheduler.ts   # LLM scheduling engine
│   │   └── ical-parser.ts     # iCal file parser
│   └── utils/
│       ├── crypto.ts          # AES-256-GCM encryption utility
│       └── debug.ts           # Debug logger
├── src/
│   ├── main.tsx               # React entry
│   ├── App.tsx                # Root component (sidebar navigation)
│   ├── api/
│   │   └── client.ts          # Axios API client
│   ├── types/
│   │   └── index.ts           # TypeScript type definitions
│   ├── utils/
│   │   └── priority.ts        # Priority calculation
│   ├── contexts/
│   │   └── ThemeContext.tsx    # Theme management (light/dark/system)
│   ├── i18n/
│   │   ├── index.tsx          # i18n init
│   │   ├── zh.ts              # Chinese translations
│   │   └── en.ts              # English translations
│   └── components/
│       ├── CalendarView.tsx    # Calendar view
│       ├── TodoList.tsx        # Todo list
│       ├── TodoForm.tsx        # Todo form
│       ├── TodoSplitModal.tsx  # Todo split modal
│       ├── SchedulePanel.tsx   # Smart scheduling panel
│       ├── ImportModal.tsx     # iCal import modal
│       └── SettingsModal.tsx   # Settings (LLM/prompts/theme/language)
```

---

## 📡 API Reference

### Health Check

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Service health check |

### Calendar & Events `/api/calendar`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/calendars` | List all calendars |
| POST | `/calendars` | Create a calendar |
| DELETE | `/calendars/:id` | Delete a calendar and its events |
| GET | `/events` | List events (supports `start`/`end` range) |
| POST | `/events` | Create an event |
| PUT | `/events/:id` | Update an event |
| DELETE | `/events/:id` | Delete an event |
| POST | `/import` | Import iCal file |
| GET | `/export-week` | Export weekly calendar as Excel (.xlsx) |

### Todos `/api/todos`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List todos (filter by `status`/`priority`) |
| POST | `/` | Create a todo (auto-calculates priority) |
| POST | `/:id/split` | Split a todo into time segments |
| PUT | `/:id` | Update a todo |
| DELETE | `/:id` | Delete a todo |

### Scheduling `/api/schedule`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/generate` | Generate a schedule (algorithm / llm) |
| POST | `/apply` | Apply a generated schedule |
| GET | `/llm-config` | Get LLM config (no API key) |
| POST | `/llm-config/test` | Test LLM connectivity |
| POST | `/llm-config` | Create LLM config |
| PUT | `/llm-config/:id/activate` | Activate a config |
| DELETE | `/llm-config/:id` | Delete a config |
| GET | `/prompt-template` | Get prompt template |
| PUT | `/prompt-template` | Update prompt template |
| POST | `/prompt-template/reset` | Reset to default template |

---

## ⚙️ Configuration

### Environment Variables

Copy `.env.example` to `.env` and customize:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Backend server port | `3000` |
| `CRYPTO_SECRET` | API key encryption secret | `smart-calendar-default-secret-key` |

> ⚠️ **Production**: Always set a strong `CRYPTO_SECRET`. Never use the default value.

### Ports

| Service | Port |
|---------|------|
| Frontend (Vite dev server) | 5173 |
| Backend (Express API) | 3000 (configurable via `PORT`) |

### Database

- Engine: sql.js (SQLite WASM — no native compilation or system SQLite required)
- File: `data/calendar.db` (auto-created on first run)
- Auto-save: every 5 seconds + on shutdown
- Write strategy: atomic (temp file + rename)

### LLM Providers

| Provider | Default Model | API Key Required |
|----------|---------------|-----------------|
| OpenAI | gpt-4o-mini | Yes |
| DeepSeek | deepseek-chat | Yes |
| Ollama | llama3 | No (local) |
| LM Studio | — | No (local) |
| Custom | — | Depends |

---

## 🏭 Production Deployment

```bash
npm run build   # Build frontend to dist/
npm start       # Start server (serves both API and static files)
```

In production, Express automatically serves the `dist/` directory — a single process on port 3000 provides the complete application.

---

## 📜 NPM Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend dev server (Vite) |
| `npm run dev:server` | Start backend dev server (tsx watch) |
| `npm run dev:all` | Start both frontend & backend concurrently |
| `npm run build` | Build frontend for production |
| `npm start` | Start production server |

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## 中文说明

一款集成日历管理、待办规划与智能调度的全栈应用。基于 Eisenhower 四象限优先级矩阵，提供算法自动排程与 LLM 智能排程两种模式，帮助你高效规划时间。

### 主要功能

- **多日历管理** — 自定义名称与颜色，支持 iCal 导入，完整 RRULE 重复事件支持
- **四象限待办** — 按紧急度与重要度自动归类 P1–P4 优先级，截止日期倒计时
- **智能调度** — 算法调度（贪心策略）与 LLM 调度（OpenAI / DeepSeek / Ollama / LM Studio）
- **智能拆分** — 超过 90 分钟的长任务自动拆分，应用后生成独立待办记录
- **深色模式** — 浅色 / 深色 / 跟随系统
- **国际化** — 中英文切换
- **日历交互** — 拖拽移动/调整时长，快速创建，Excel 周历导出
- **安全** — API 密钥 AES-256-GCM 加密存储

### 快速开始

```bash
git clone https://github.com/ADA-quart/Intelligent-To-Do-Calendar.git
cd Intelligent-To-Do-Calendar
npm install
npm run dev:all
```

Windows 用户可直接双击 `install.bat` → `start.bat` 一键启动。
