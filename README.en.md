<div align="center">

<img src="public/icons/icon-512.png" width="108" alt="Day Day New app icon">

<h1>Day Day New — Smart To-dos &amp; Timetable</h1>

<p>A local-first <b>todo + class-schedule</b> app for Android (and the web).<br>
Manage tasks in an Eisenhower matrix, then let an algorithm or an LLM slot them into the free
periods of your real timetable — the same timetable imported straight from your school system.<br>
Reminders, a home-screen widget and offline OCR (screenshot → todo) all run on the device.</p>

<p><i>苟日新，日日新，又日新</i> — “If you can renew yourself one day, do it day after day, and keep renewing.”<br>
The name comes from <i>The Book of Rites</i> (《礼记·大学》).</p>

<p>
  <a href="https://github.com/ADA-quart/ITDC/releases/latest"><b>Download Android APK</b></a> ·
  <a href="README.md">中文</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p>
  <a href="https://github.com/ADA-quart/ITDC/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/ADA-quart/ITDC/ci.yml?branch=main&label=CI"></a>
  <a href="https://github.com/ADA-quart/ITDC/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/ADA-quart/ITDC?label=release&color=blue"></a>
  <img alt="Platform: Web / Android / PWA" src="https://img.shields.io/badge/platform-Web%20%7C%20Android%20%7C%20PWA-blue">
  <a href="LICENSE"><img alt="License: PolyForm Noncommercial 1.0.0" src="https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-orange"></a>
</p>

<p><sub>This is a personal project. It has <b>no relationship with SenseTime or its “SenseNova” (日日新) large model</b>.</sub></p>

</div>

---

## What it is

A tool that **connects your to-dos with your timetable**. Todo apps don't know when you have class; timetable apps don't know how much work is waiting.

- **Timetable side** — import the real schedule from your school system (Mon–Sun, seven class blocks plus a night slot), week/day views, in-class todos, class reminders.
- **Todo side** — Eisenhower four quadrants; tap *Plan* and the algorithm (or an LLM) places each task into a **free slot of your timetable**, obeying quiet-hour rules: never before 08:00, never during lunch/dinner, never squeezed into gaps under 30 minutes, and finished by 22:00 — with a 22:00–22:30 extension reserved for *urgent & important* items only.
- **Together** — a task scheduled inside a class is **merged into that class block**; you can drag a todo to another period; long-press a class to see what you planned to do in it.

By default **all data stays on the device**. The network is used only for three things: calling your LLM provider, fetching your school timetable, and the cross-device sync you explicitly enable.

## Screenshots

| Calendar | Todos (four quadrants) | Smart planning |
| :---: | :---: | :---: |
| ![Calendar](docs/images/app-calendar.png) | ![Todos](docs/images/app-todos.png) | ![Planning](docs/images/app-schedule.png) |

| Review (weekly recap / streak) | Home-screen widget |
| :---: | :---: |
| ![Review](docs/images/app-review.png) | ![Widget](docs/images/widget.png) |

## Core features

### Todos: four quadrants + automatic scheduling

- **Quadrant board** — urgent & important / important / urgent / normal, each cell shows what's left and opens the full list. Tap for details, long-press to delete.
- **Two scheduling engines** — with an LLM configured you get AI decomposition + planning (and every returned slot is re-validated by the client algorithm); without it, the app falls back to a **pure local rule engine** that still fits tasks into gaps.
- **One shared policy** across client algorithm, server algorithm, prompt and validator (`shared/schedule-policy.ts`):

| Rule | Value |
| --- | --- |
| Earliest start | 08:00 |
| Latest start | 21:00 — **22:30 for “urgent & important”** |
| Latest end | 22:00 — **22:30 for “urgent & important”** |
| Minimum usable gap | 30 minutes |
| Buffer before the next event | 5 minutes |
| Protected windows | Lunch 11:50–13:00, dinner 18:00–19:00 |
| Max segment | 90 minutes (long tasks are split, with breaks inserted) |

- **“Can be done in class”** — such todos may be placed inside a class period and are merged into that course block.
- **Split segments** — a three-hour task becomes several scheduled pieces, each checkable on its own.
- **Two independent reminder types** — class reminders fire **N minutes before** each imported class (course, time, room, teacher; can be silent); todo reminders fire before the **scheduled start time / deadline**, with the lead time typed in freely (0 = on time). Separate channels, one does not affect the other.

### Timetable: import + week grid

- **One-tap import** — pick your school, enter student ID and password, and the app logs in through the unified authentication flow and pulls the current semester (no manual Excel wrangling).
- **Daily auto-sync** — the schedule is refreshed on the first launch of each day, and there's a manual “Update timetable” button.
- **The week view *is* the timetable grid** — seven class blocks sized by their **real duration** (95/60/40 minutes no longer look identical) plus a 21:35–22:30 “night” row, so plans made in the library until 22:30 still have a place.
- **Course blocks** show course name, room and time; a class spanning several blocks is shown as one continuous bar; tap for details, long-press to drag or delete.
- **Anything outside class hours** goes to a separate “extra time” row instead of being stacked on top of a class.

### Screenshot → todo (multimodal + offline OCR)

The “image” button on the todo page turns a screenshot into todos through a graceful degradation chain:

1. **Direct multimodal** — send the image to a vision-capable model (multiple todos per image; expired ones are skipped).
2. **On-device OCR** — if the model has no vision support or you are offline, **PP-OCRv4** (the ONNX build of PaddleOCR / RapidOCR, running on onnxruntime-web) reads the text locally and the text parser takes over. **Fully offline, no Google services required.**
3. **Save the raw text** — if parsing also fails, the recognised text is stored as a todo you can tidy up later.

The OCR models (4.7 MB detector + 10.9 MB recogniser) are not bundled: download them in *Settings → General → Offline OCR extension* and delete them any time.

The pure-algorithm path (works with no LLM at all) also handles **chat logs**: group-chat and group-announcement screenshots are parsed as *message blocks* (sender names, timestamps and announcement controls act as separators, so a message split across OCR lines is reassembled). Small talk and questions are skipped; a year-less date in an announcement is anchored to the **announcement's post date** (a “Oct 8” posted on 09/26 means that year's 10-08), and already-due items are skipped instead of rolling to next year.

### Home-screen widget

- Today / tomorrow columns plus a scrollable todo list; todos can be ticked straight from the home screen.
- Tapping anywhere (except the checkbox area) opens the app.
- Its own colours, opacity and light/dark mode — including **follow the system**, which resolves colours from `values-night` resources so the widget switches instantly without waiting for the app process to wake up.
- Can reuse your in-app background image: fixed frame, aspect-preserving crop, identical to what you see in the app.

### Review & weekly recap

- “Review” has today and this-week views: classes attended, todos completed, what is overdue.
- The weekly recap shows completed count, time invested, per-day distribution, comparison with last week, and your **streak of consecutive weeks with records**.
- Overdue items and late completions are reported separately.

### Personalisation

- **Background image**: aspect-preserving crop with a draggable focal point, 0.5–3× zoom (below 1× the surroundings are filled with a blurred, enlarged copy of the same image, so no blank edges).
- **Glassmorphism**: opacity and blur for calendar cards, timetable cells and the bottom navigation; at full transparency text colours adapt to the image's brightness.
- **Two layers, tuned separately**: the appearance page groups the sliders into *Crop & framing / Wallpaper layer / Panel layer* — **background image opacity** only affects the wallpaper, **panel opacity** covers the calendar, cards and bottom nav. Number inputs (lead times etc.) use the same material as their own field, so nothing looks half solid and half see-through.
- **Accent colour**: eight presets + colour picker, set separately for the app and the widget.
- **Layout tokens**: 44 px control height (Apple HIG 44 pt), one radius scale (6 / 12·8 / 12 / 14), fully tappable bottom navigation.

### Data, import/export, offline

- **Offline-first**: everything works without a network; writes land locally first.
- **Import/export**: iCal (.ics) both ways, export the current week to Excel (shared through the system sheet on mobile).
- **Optional cross-device sync**: enter a sync ID to merge both devices record by record, run your own server, or stay local-only.

## Quick start

1. **Install** — grab `itdc-vX.Y.Z.apk` from [Releases](https://github.com/ADA-quart/ITDC/releases/latest); allow “unknown sources” on first install. Upgrades usually install straight on top.
2. **Import your timetable** — Settings → General → pick your school → enter ID and password → import the current semester.
3. **Configure a model (optional)** — Settings → LLM: provider + API key. With it you get AI decomposition, AI planning and direct image input; without it, local rule parsing and local scheduling still work.
4. **Add a todo and plan** — create one (or use AI / image input) and press *Plan* on the Smart planning page.

> Widget not refreshing? Set *Settings → Apps → Day Day New → Battery saver* to **unrestricted** (MIUI / HyperOS and friends freeze background refresh).

## Three ways to run it

| Mode | Where the data lives | Requirements | Good for |
| --- | --- | --- | --- |
| **Local only** (default) | Phone database | Nothing | Using it alone; data never leaves the phone |
| **Cross-device sync** | Phone + sync service | A sync ID | Phone plus tablet/web |
| **Self-hosted** | Your own server | Deploy `server/` | Full control over your data |

## Data & privacy

- Timetable, todos, events and appearance settings live **on the device** (IndexedDB / local database) by default.
- LLM API keys and the school password are kept in **encrypted system storage** (Android Keystore), not in plain config files.
- Only three operations touch the network — LLM calls, timetable import and sync — and each sends only what it needs.
- No analytics, telemetry or third-party reporting SDKs.

## Tech stack

| Layer | Choice |
| --- | --- |
| Shell & packaging | Capacitor 8 (Android + PWA share one front-end) |
| Front-end | React + TypeScript + Vite + Ant Design 5 |
| Calendar | FullCalendar (month/week/day) + a custom timetable grid |
| Widget | Native Android RemoteViews (Java) with scrollable lists |
| Offline OCR | PP-OCRv4 ONNX + onnxruntime-web (models downloaded on demand) |
| Scheduling | Local rule engine in TypeScript, sharing one policy with the server |
| Optional server | Node service for sync / scheduling / LLM proxying (`server/`) |
| Tests | Vitest (covering scheduling, timetable parsing and sync merging) |

## Project layout

```
src/                 front-end (React)
  api/               local storage, scheduling engine, LLM, OCR installer
  components/        pages and components (timetable grid, quadrants, settings…)
  i18n/              Chinese / English copy
shared/              policy & parsers shared by client and server
server/              optional server (sync, scheduling, LLM proxy)
plugins/itdc-widget/ native widget plugin (Java)
android/             Capacitor Android project
docs/                architecture, deployment, widget notes, research
```

## Development

```bash
npm install
npm run dev                 # develop in the browser (all front-end features work)
npm run test                # unit tests
npm run android:sync        # build the front-end and sync it into android/
npm run android:open        # open in Android Studio

# build a debug APK directly
./android/gradlew.bat -p android assembleDebug
```

Requires Node 20+ and JDK 21 for Android builds. Release steps live in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — data flow, offline-first strategy, module boundaries
- [Widget internals](docs/WIDGET.md) — RemoteViews, bitmap budget, refresh timing
- [Todo research](docs/todo-research-2026-10.md) — quadrants and scheduling trade-offs
- [API](docs/API.md) · [Deployment](docs/DEPLOYMENT.md)
- [Changelog](CHANGELOG.md)

## FAQ

**The widget stopped refreshing / shows “open the app to refresh” in the morning.**
Set battery saver to *unrestricted*. Refreshes are aligned to class end, midnight, unlock and a two-hour fallback, but a frozen background process still waits for the next wake-up.

**“Checking for updates” says the API is rate-limited.**
GitHub throttles anonymous requests; wait a while or open the Releases page directly.

**Timetable import fails.**
Check the credentials and that your network can reach the school system; a failed import never touches the existing timetable.

**How big is the OCR download?**
4.7 MB detector + 10.9 MB recogniser ≈ 15.6 MB; fully offline afterwards and deletable at any time.

**Why isn't anything scheduled after 22:00?**
By default nothing starts after 21:00 and everything must end by 22:00; only todos marked *urgent & important* may use the 22:00–22:30 window.

## Known limitations

- Timetable import currently supports **Chengdu University of Technology** only (see `shared/cdut-parser.ts` to add others).
- On-device OCR targets **phone screenshots** (horizontal text); rotated or vertical text is not supported.
- The home-screen widget is a native Android implementation; there is no iOS plan.

## Contributing

Issues and PRs are welcome. For bug reports please include version, device and reproduction steps; for changes keep `npm run test` and `npx tsc --noEmit` green and add a note under the unreleased section of `CHANGELOG.md`.

## License

- Code: [PolyForm Noncommercial License 1.0.0](LICENSE) — personal, non-commercial use and modification only.
- Third-party dependencies and models: see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) (OCR models are PaddleOCR / RapidOCR, Apache-2.0).
- The name comes from the *Book of Rites*; this project is unrelated to SenseTime's “SenseNova” (日日新) model.
