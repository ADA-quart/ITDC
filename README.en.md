<div align="center">

<h1>ITDC</h1>

<h3>Local-first calendar, todo, and smart scheduling</h3>

<p>Your data stays on your own device — no server required<br>
Turn on sync when you want your phone and PC to share data. Both sides merge; neither overwrites the other</p>

<p>
  <b>English</b> ·
  <a href="README.md">简体中文</a> ·
  <a href="https://github.com/ADA-quart/ITDC/releases/latest">Download APK</a>
</p>

<p>
  <a href="https://github.com/ADA-quart/ITDC/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ADA-quart/ITDC/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/ADA-quart/ITDC/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/ADA-quart/ITDC"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Web%20%7C%20Android-informational">
</p>

<img src="docs/images/app-calendar.png" alt="ITDC calendar view" width="880">

</div>

## Features

- 📅&nbsp;Multiple calendars with custom names and colors
- 🔁&nbsp;Full RRULE support — build a recurring weekly class schedule
- 📥&nbsp;iCal import and export, 📤 weekly export to Excel
- 🎓&nbsp;School timetable import via CAS login — bring in a whole semester as calendar events; the native app connects to the school directly, with no relay server
- 🖱️&nbsp;Drag to move events, drag edges to resize, click empty space to create
- ✅&nbsp;Eisenhower matrix todos, auto-classified P1–P4
- ⏰&nbsp;Deadline countdown with overdue highlighting
- 🔔&nbsp;Reminders — on Android, a system notification at a todo's scheduled start or deadline
- ✂️&nbsp;Long tasks split automatically, with breaks between segments
- 📊&nbsp;Daily review — overdue, due-today, pending and done counts plus a 7-day trend
- 💬&nbsp;Natural language input — type "submit the report Friday afternoon"
- 🧠&nbsp;Two scheduling modes: a local algorithm, or hand it to an LLM — works in this-device-only mode too, calling the provider directly with keys kept on device
- 🌓&nbsp;Light / dark / follow system
- 🎨&nbsp;Personalisation: accent colour, background image, widget palette
- 🌍&nbsp;Simplified Chinese and English
- 📴&nbsp;Works offline — reads and writes are unaffected
- ⬆️&nbsp;Update check — query GitHub Releases from Settings; it only notifies, never downloads

## Screenshots

<p align="center">
  <img src="docs/images/app-todos.png" alt="Todo management with Eisenhower matrix" width="440">
  <img src="docs/images/app-review.png" alt="Daily review with stats and trends" width="440">
</p>

## Home Screen Widget

The Android widget is interactive, not a static image:

<p align="center">
  <img src="docs/images/widget.png" alt="Android home screen widget" width="400">
</p>

- 🗓️&nbsp;**Today / Tomorrow** columns with color markers, class name, location, and time
- ☑️&nbsp;Scrollable todo list — tap a checkbox to complete; done items get strikethrough and sink to the bottom
- ⏳&nbsp;Ended classes disappear on their own, without opening the app
- 🏷️&nbsp;Header shows the calendar of your next class, the date, and the teaching week
- 🎨&nbsp;Rounded frosted look that follows the system light/dark setting
- 🖌️&nbsp;Panel colour, opacity, brightness, and background image are all editable in the app and apply immediately
- 📴&nbsp;Works in local-only mode too — no server needed

Everything lives under **Settings → Appearance**: pick a preset accent colour or use the colour
picker, upload a local image as the app background with its own opacity and blur controls, and let
the widget either follow the app palette or use its own panel colour and brightness. Set panel
opacity to 0 for a text-only widget.

## Quick Start

**Android** — download the APK from [Releases](https://github.com/ADA-quart/ITDC/releases/latest).

**Web / desktop**

```bash
git clone https://github.com/ADA-quart/ITDC.git
cd ITDC
npm install
npm run dev:all          # frontend 5173 + backend 3000
```

Open http://localhost:5173 . The default mode is local-only, so nothing needs configuring.

**Windows** — run `install.bat`, then `start.bat`. The second prints your LAN IP for connecting a phone.

## Three Ways to Use It

| Mode | When | How to set up |
|------|------|---------------|
| Local only (default) | One device | Nothing to configure |
| LAN | Phone connecting to your PC | Run `npm start` on the PC; enter `http://<PC-IP>:3000/api` on the phone |
| Public | Multiple devices on any network | Deploy to a cloud host or use a tunnel; enter `https://<domain>/api` |

When you switch to sync mode, both sides are **merged**: records unique to either side are kept, and
records on both sides use whichever was modified more recently.

> ⚠️ The server has no account system — anyone who can reach the address can read and write your data.
> Add access control before exposing it publicly. See [SECURITY.md](SECURITY.md).

## Tech Stack

React 18 · TypeScript · Ant Design 5 · FullCalendar 6 · Vite 6 · IndexedDB
· Express · sql.js (a WASM build of SQLite — no native compilation) · Capacitor 8

## Documentation

| Document | Contents |
|----------|----------|
| [Architecture](docs/ARCHITECTURE.md) | Data flow, how merge sync works, why these choices |
| [Deployment](docs/DEPLOYMENT.md) | LAN, tunnels, cloud platforms, Docker |
| [Widget](docs/WIDGET.md) | Design, data channel, Android platform limits |
| [API](docs/API.md) | Every HTTP endpoint |
| [Security](SECURITY.md) | Threat model, keys, where data lives |
| [Changelog](CHANGELOG.md) | Version history |
| [Contributing](CONTRIBUTING.md) | Development conventions |

> Documentation is currently written in Chinese. This file is the English README.

## Configuration

Copy `.env.example` to `.env` (not needed in local-only mode).

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Listen address; use `127.0.0.1` to restrict to this machine |
| `DB_PATH` | `data/calendar.db` | SQLite file path |
| `CRYPTO_SECRET` | dev default | Encrypts LLM API keys. **Required in production** — `openssl rand -hex 32` |
| `CORS_ORIGINS` | empty | Extra allowed frontend origins, comma-separated |
| `CORS_ALLOW_ALL` | empty | Set to `1` to allow any origin — internal or self-hosted deployments only |

## Development

```bash
npm run dev:all         # dev mode
npx tsc --noEmit        # type check
npx vitest run          # unit tests
npm run build           # build frontend
```

Building the APK (the order matters — running `gradlew` alone won't repackage the frontend assets):

```bash
npm run android:sync
cd android && ./gradlew assembleDebug
```

## FAQ

**The widget doesn't refresh on its own** — Chinese vendor ROMs restrict background by default.
Settings → Apps → ITDC → Battery saver → No restrictions.

**My phone can't reach the PC** — Confirm both are on the same network and `start.bat` is running.
Check whether Windows Firewall allows port 3000.

**Where is my data?** — Server mode: `data/calendar.db`. Local-only mode: the browser's IndexedDB,
which you can back up with "Export iCal".

**How do I import my school timetable?** — Pick your school under Settings → General and the calendar
sidebar shows an "Import Timetable" button. Sign in with your school CAS credentials, choose a semester
and enter the Monday of week 1 to import the whole semester as a new calendar. Chengdu University of
Technology is currently built in. School configs live in `shared/schools.ts`, the starting point for
adding another school.

**The teaching week number is wrong** — It's currently estimated as "the week containing September 1
is week 1", which may differ from your institution's calendar.

**Why is the APK debug-signed?** — No release keystore is configured. Fine for personal use, not for
app store distribution.

## License

[MIT](LICENSE) © 2026 ADA-quart
