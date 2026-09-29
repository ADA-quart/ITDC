<div align="center">

# ITDC

**A local-first calendar, todo, and smart scheduling application**

Data is stored on your device by default, so the app is fully usable without a server.
An optional sync service is available when you want to share data across devices.

**English** | [简体中文](README.md)

[![CI](https://github.com/ADA-quart/ITDC/actions/workflows/ci.yml/badge.svg)](https://github.com/ADA-quart/ITDC/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ADA-quart/ITDC)](https://github.com/ADA-quart/ITDC/releases/latest)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Web%20%7C%20Android-informational)

[Download APK](https://github.com/ADA-quart/ITDC/releases/latest) · [Features](#features) · [Getting Started](#getting-started) · [Documentation](#documentation)

</div>

---

## Design Principles

This project takes a different approach from typical online calendar services in three respects.

**Data is stored locally by default.** Calendar, todo, scheduling, and iCal/Excel import and export are all
performed on the client, with data persisted in the browser's IndexedDB. No account registration is required
and there is no cloud dependency; the application remains fully functional while offline. A server is
optional and only needed when you want to share data across devices.

**Multiple devices are synchronized by merging, not overwriting.** When connecting to a server, local and
remote records are merged by a stable identifier: records that exist on only one side are preserved, and
records present on both sides are resolved in favor of the more recently modified one. This matches the
behavior of browser bookmark sync and never replaces one side with the other.

**The Android home screen widget provides full interactivity.** It contains two columns for today's and
tomorrow's schedule and a scrollable todo list, and it supports completing items directly from the home
screen with strikethrough styling. Classes that have already ended are hidden automatically. The widget uses
a rounded, frosted appearance and follows the system light/dark setting. It also works in local-only mode.

## Features

### Calendar Management

- Multiple calendars with custom names and colors
- Full **RRULE** support (RFC 5545), suitable for representing a recurring weekly class schedule
- iCal (`.ics`) import and export
- Direct manipulation: drag to move events, drag edges to resize, click empty space to create
- Export the current week as an Excel workbook with two sheets: a weekly view and an event list

### Todo Management

- Automatic **Eisenhower matrix** classification into P1 through P4 by urgency and importance
- Status flow: pending → scheduled → completed
- Deadline countdown with highlighting for overdue items
- Automatic splitting of long tasks: anything over 90 minutes is divided into segments with breaks between them
- **Natural language input**: typing "submit the report Friday afternoon" produces a structured todo
  (requires an LLM to be configured)

### Smart Scheduling

Two scheduling modes are available:

| Mode | Requires server | Description |
|------|-----------------|-------------|
| **Algorithmic** | No | Greedy strategy. Orders by priority and deadline, avoids existing events, restricts work to 7:00–23:00, and inserts a 15-minute break after every 2 hours of continuous work |
| **LLM-based** | Yes | Delegates scheduling to a large language model for context-aware results |

Both modes validate the generated plan (time conflicts, late-night slots, deadlines exceeded) before it can be applied.

LLM support covers OpenAI, DeepSeek, Ollama, LM Studio, and any compatible endpoint. API keys are stored
encrypted with AES-256-GCM and are never returned in plaintext by the API.

### Android Home Screen Widget

- Header shows the calendar of the next upcoming class, the date, and the teaching week number
- **Today / Tomorrow** columns with color markers, class name, location, and time
- Scrollable todo list; tap a checkbox to complete an item, which then shows strikethrough and moves to the end
- A "Complete all" action
- Ended classes are hidden automatically, without opening the app
- Rounded frosted appearance that follows the system light/dark setting
- Works in local-only mode: the app pushes the current day's data to the native side for rendering

Implementation details and platform limitations are documented in [docs/WIDGET.md](docs/WIDGET.md) (Chinese).

### Other

- Theme: light / dark / follow system
- Interface language: Simplified Chinese / English
- Offline capable: reads and writes work normally while offline; only synchronization pauses
- Responsive layout: switches to a vertical stack on narrow screens, giving the calendar the full width

## Getting Started

### Requirements

- Node.js >= 18
- Building the Android client additionally requires JDK 21 and the Android SDK (compileSdk 36)

### Running from Source

```bash
git clone https://github.com/ADA-quart/ITDC.git
cd ITDC
npm install
npm run dev:all
```

Open http://localhost:5173 . The default mode is local-only, so no configuration is needed.

### Windows One-Click Scripts

Run `install.bat`, then `start.bat`. The start script also prints the machine's LAN IP address, which is
convenient when configuring the server address on a phone.

### Android Client

Download and install the APK from [Releases](https://github.com/ADA-quart/ITDC/releases/latest).

> The APK is signed with a debug key. It is intended for personal use and testing, not for distribution
> through an app store. The first install requires allowing installation from unknown sources.
> Subsequent versions can be installed over the existing one and local data is preserved.

## Usage Modes

| Mode | Suitable for | Configuration |
|------|--------------|---------------|
| **Local only** (default) | Single device | None |
| **LAN** | Home or dormitory, phone connecting to a PC | Run `npm start` on the PC, then enter `http://<PC-IP>:3000/api` in the phone's settings |
| **Public** | Multi-device sync on any network | Deploy to a cloud platform or use a tunnel, then enter `https://<domain>/api` |

Switching to cross-device sync merges local and server data: records unique to either side are preserved,
and records present on both sides use the newer modification time.

> ⚠️ The server has no authentication layer. Anyone who can reach the address can read and write all data.
> Access control must be configured before exposing it publicly. See [SECURITY.md](SECURITY.md) (Chinese).

Deployment instructions are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (Chinese).

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | React 18 · TypeScript · Ant Design 5 · FullCalendar 6 |
| Build | Vite 6 |
| Local storage | IndexedDB |
| Backend | Express · sql.js (a WASM build of SQLite, no native compilation needed) |
| Mobile | Capacitor 8 · a custom Android widget plugin |

Rationale for these choices is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (Chinese).

## Project Structure

```
ITDC/
├── src/                 Frontend (React)
│   ├── api/             Data layer: local storage, local algorithms, sync merge
│   ├── components/      UI components
│   ├── i18n/            Chinese and English strings
│   └── types/           Shared type definitions
├── server/              Backend (Express + sql.js)
│   ├── routes/          API routes
│   ├── services/        Scheduling, LLM, iCal parsing
│   └── db/              Database wrapper and migrations
├── plugins/itdc-widget/ Android home screen widget (Capacitor plugin)
├── android/             Capacitor-generated Android project
├── docs/                Documentation
└── scripts/             Build scripts
```

## Documentation

The project documentation is currently written in Chinese.

| Document | Contents |
|----------|----------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Data flow, merge synchronization, technology rationale, known technical debt |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | LAN, tunneling, cloud platforms, Docker |
| [WIDGET.md](docs/WIDGET.md) | Widget design, data channel, Android platform limitations |
| [API.md](docs/API.md) | Complete HTTP API reference |
| [SECURITY.md](SECURITY.md) | Threat model, key management, data storage locations |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development environment and commit conventions |

## Configuration

Server configuration is provided through `.env`. Local-only mode requires none of it.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server listening port |
| `HOST` | `0.0.0.0` | Listening address. Set to `127.0.0.1` to restrict access to the local machine |
| `DB_PATH` | `data/calendar.db` | Location of the SQLite database file |
| `CRYPTO_SECRET` | Development default | Key used to encrypt LLM API keys. Required in production; generate with `openssl rand -hex 32` |
| `CORS_ORIGINS` | empty | Additional allowed frontend origins, comma-separated |
| `CORS_ALLOW_ALL` | empty | Set to `1` to allow any origin. Recommended only on private networks |

Localhost and LAN addresses are allowed by default. See [.env.example](.env.example) for a full example.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev:all` | Start frontend (5173) and backend (3000) together |
| `npm run dev` | Start the frontend only |
| `npm run dev:server` | Start the backend only, with hot reload |
| `npm run build` | Build the frontend to `dist/` for web deployment |
| `npm run build:native` | Build frontend assets for the APK and replace the service worker with a cleanup script |
| `npm start` | Start the server in production mode |
| `npm run android:sync` | Build the frontend and sync assets into the Android project |
| `npm test` | Run unit tests |

### Building the APK

```bash
npm run android:sync
cd android && ./gradlew assembleDebug
```

The output is at `android/app/build/outputs/apk/debug/app-debug.apk`.

The build order matters: running `gradlew` alone does not repackage the frontend assets. `build:native`
replaces the PWA service worker with a self-cleaning script; without it, the WebView loads cached code after
an APK upgrade, which appears as "the new version is installed but nothing changed".

## FAQ

**The widget does not refresh automatically**

Some vendor ROMs (HyperOS, MIUI, and others) restrict background execution by default. Go to
Settings → Apps → ITDC → Battery saver and set it to **No restrictions**. The app's settings page detects
this state and provides a shortcut.

**Ended classes still appear briefly**

Hiding ended classes depends on the system's periodic refresh. The shortest interval on Android is about
30 minutes, so a class may remain visible for a few minutes after it ends.

**The phone cannot reach the PC**

Confirm both devices are on the same network and that `start.bat` is running. Enter
`http://<PC-IP>:3000/api` as the server address; the IP is printed by `start.bat`. If it still fails, check
whether Windows Firewall allows port 3000.

**Where is the data stored, and how do I back it up?**

In server mode, data lives in `data/calendar.db`; copying that file is sufficient for a backup. In
local-only mode, data is stored in the browser's IndexedDB and can be exported through "Export iCal" or
"Export this week".

**The teaching week number does not match my school calendar**

The week number is currently derived from "the week containing September 1 is week 1", which may differ from
an institution's actual academic calendar.

**Why is the APK debug-signed?**

No release keystore is configured. This does not affect personal use, but it is not suitable for app store
distribution.

## Development

Please ensure the following commands pass before submitting changes:

```bash
npx tsc --noEmit    # type check
npx vitest run      # unit tests
npm run build       # build
```

Conventions and caveats are described in [CONTRIBUTING.md](CONTRIBUTING.md) (Chinese).

## License

[MIT](LICENSE) © 2026 ADA-quart

Licenses for third-party dependencies are included in their respective packages.
