<p align="center"><img src="public/icons/icon-512.png" width="88" alt="日日新"></p>

<h1 align="center">日日新 · ITDC</h1>

<p align="center">
  <b>Timetable + smart to-dos for Chengdu University of Technology</b><br>
  Android app / browser (PWA) · local-first · optional self-hosted sync
</p>

<p align="center">
  <a href="https://github.com/ADA-quart/ITDC/releases/latest"><img src="https://img.shields.io/github/v/release/ADA-quart/ITDC?label=release&color=1677FF" alt="release"></a>
  <a href="https://github.com/ADA-quart/ITDC/actions/workflows/android-apk.yml"><img src="https://github.com/ADA-quart/ITDC/actions/workflows/android-apk.yml/badge.svg" alt="Android APK"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-8957e5" alt="license"></a>
  <img src="https://img.shields.io/badge/platform-Android%207.0%2B%20%7C%20Web-3DDC84?logo=android&logoColor=white" alt="platform">
</p>

<p align="center">
  <img src="docs/images/app-glass.png" width="23%" alt="Liquid glass appearance">
  <img src="docs/images/app-timetable.png" width="23%" alt="Timetable view">
  <img src="docs/images/app-calendar.png" width="23%" alt="Today">
  <img src="docs/images/app-todos.png" width="23%" alt="Todos">
</p>

<p align="center"><sub>Screenshots taken from the Android emulator with demo data (UI is in Chinese).</sub></p>

<p align="center"><a href="README.md">简体中文</a> | <b>English</b></p>

## What is this

ITDC keeps your **class timetable** and your **to-dos** in one app.

Sign in with the university's unified authentication (CAS) and your semester timetable is imported and
kept up to date. Classes come with reminders and a home-screen widget; to-dos live in an
urgency/importance matrix, and anything that does not fit into your week can be packed into the gaps
of your timetable by a local algorithm or an LLM.

Highlights:

- **Local-first.** Data stays on your device (IndexedDB); working offline with no server at all is the
  normal case.
- **Direct login.** The app talks to the university CAS and the academic system itself, without
  third-party relays.
- **Optional sync.** Self-host a small Node server when you want your phone and laptop to share one
  dataset ([deployment guide](docs/DEPLOYMENT.md)).
- **Unofficial.** Built and maintained by students; not affiliated with Chengdu University of
  Technology.

## Features

**📚 Timetable**

- **Import from the academic system.** Sign in with the university's unified authentication (CAS)
  inside the app, pick a semester, and your timetable is imported as calendar events. Credentials can
  be remembered; the password is encrypted with the Android Keystore and stays on the device.
- **Week numbers, automatically.** The academic system does not publish term start dates. Enter the
  Monday of week 1 once during import, and week numbers are derived from it.
- **Kept fresh.** The timetable refreshes silently the first time you open the app each day; you can
  also update it manually.
- **Three views.** Day, week and a timetable grid, with swipe navigation between days and weeks.
- **Course colors.** 18 bright presets; the same course keeps the same color and different courses try
  not to clash. Any course can be recolored individually.
- **Class reminders.** A notification before each class with the course name, room and time. The lead
  time defaults to 10 minutes and can be changed, including a silent mode; notifications can be set to
  auto-dismiss after a configurable number of minutes.

**✅ To-dos**

- **Quadrants.** Tasks are sorted into four quadrants by urgency and importance; tap a quadrant to see
  its tasks.
- **Natural language.** Type “hand in the weekly report before Friday afternoon” and a to-do is
  created — understood by an LLM when configured, or by the built-in offline parser otherwise.
- **From images.** Drop in a slide or notification screenshot and extract to-dos; a multimodal LLM
  reads it by default, with an optional offline OCR model as a fallback.
- **Can do in class.** Tasks marked as doable during class may be scheduled into class time.
- **Time splitting.** Large tasks can be split into several slices, automatically or manually.
- **Reminders.** Notifications before the scheduled time or the deadline, with adjustable lead time.
  A to-do can also be pinned as the widget's countdown target.

**🧠 Smart scheduling**

- **Algorithm mode.** Runs entirely on-device with no model: to-dos are packed into free slots,
  avoiding classes, lunch and late nights.
- **LLM mode.** Works with OpenAI-compatible services such as DeepSeek, OpenAI or Ollama, so the model
  can follow your preferences. In on-device mode, API keys are kept in the system keystore.
- **Validated plans.** Every plan is checked for conflicts; items that could not be placed are listed
  explicitly.
- **Merged with classes.** A task scheduled into a lesson appears in that lesson's details and as a
  badge on the timetable.

**📈 Review**

- **Today.** Overdue, due today, pending and completed counts, a 7-day created-vs-completed trend, and
  quadrant distribution.
- **This week.** Classes attended, to-dos completed, streak, daily completion chart, a comparison with
  last week — and a one-line weekly note.

**🧩 Home-screen widget (Android)**

- **Four entries.** Standard 4×2 “Timetable + To-dos”, a compact “(small)” variant, a timetable-only
  widget, and a days-matter-style “Countdown”. They share one dataset and adapt as you resize — the
  Countdown shrinks down to a 2×1 strip, the timetable-only one to a single row, and the square small
  size falls back to a single “today” column.
- **Timetable and to-dos.** Today and tomorrow columns plus a to-do list; all three areas scroll, and
  finished classes disappear on their own.
- **Check off on the home screen.** Ticking a to-do there is written back to the app automatically.
- **Countdown.** A large number counting down to the nearest target (start / in progress / deadline),
  refreshing more often as it gets close; pin a to-do as the target, and several countdown widgets can
  each follow their own.
- **Separate appearance.** Panel color, opacity, light/dark and background image (with pre-blur) can be
  set independently, and reset to default in one tap.
- **Per-instance styling.** “Widgets on your home screen” under Appearance lists every instance and
  lets each one use its own background image (inherit / none / custom, with zoom, focus and blur)
  without affecting the others.

**🎨 Personalization**

- **Accent color.** 11 presets, shared by buttons, selection states and the widget.
- **Background image.** Focus, zoom and blur plus separate opacity for the wallpaper and panel layers;
  the app and the widget share the same image, and any single widget can use its own (see the widget
  section).
- **Liquid glass.** Stronger blur, saturation and inner highlight for cards and the bottom bar.
- **Light / dark / system**, three text tones for course blocks, and phone / landscape / tablet
  layouts.

**💾 Data**

- **Local-first.** By default everything stays on the device.
- **Import & export.** iCal import/export and weekly Excel export.
- **Optional sync.** Self-host an Express + SQLite server and point your phone and laptop at the same
  address.
- **Licenses page.** Third-party notices are available in the app and in
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Screenshots

<p align="center">
  <img src="docs/images/widget.png" width="46%" alt="Home-screen widget">
  <img src="docs/images/app-schedule.png" width="23%" alt="Smart scheduling">
  <img src="docs/images/app-review.png" width="23%" alt="Weekly review">
</p>

<p align="center">
  <img src="docs/images/app-review-today.png" width="23%" alt="Today review">
  <img src="docs/images/app-appearance.png" width="23%" alt="Appearance settings">
  <img src="docs/images/app-import.png" width="23%" alt="Timetable import">
  <img src="docs/images/app-glass.png" width="23%" alt="Liquid glass">
</p>

## Download

Grab the APK from [Releases](https://github.com/ADA-quart/ITDC/releases/latest) (`itdc-vX.Y.Z.apk`, Android 7.0+).

- The APK is signed with a **debug key**: fine for personal use and testing, not for app stores.
- Allow “unknown sources” for the first install; later versions upgrade in place and keep your data.
- If the widget stops refreshing, set the battery policy to **unrestricted** — Chinese OEM ROMs such
  as HyperOS and MIUI restrict background apps by default.
- The web build runs in Chrome / Edge with the same features, except notifications, the widget and the
  system keystore, which are Android-only.

## Build from source

Requirements: Node.js 22+, JDK 21, Android SDK (platform 36 / build-tools 36).

```bash
npm install
npm run dev                 # web version at http://localhost:5173

npm run android:sync        # build web assets and sync into the Android project
cd android
./gradlew assembleDebug     # -> app/build/outputs/apk/debug/app-debug.apk
```

Local debug builds use their own application id (`io.github.adaquart.itdc.debug`, shown as “ITDC
Debug”) so they can coexist with the release build. Pushing a `v*` tag makes GitHub Actions build the
APK and publish a release.

## Project layout

| Path | Contents |
| --- | --- |
| `src/` | React front-end: calendar, to-dos, scheduling, review and settings UI, plus data and business logic in `api/` |
| `shared/` | Code shared by client and server: timetable parser (`cdut-parser`), course colors, iCal helpers |
| `server/` | Optional sync server (Express + SQLite); not deploying it does not affect local use |
| `plugins/itdc-widget/` | Android native plugin: home-screen widget, notification scheduling, system keystore |
| `android/` | Capacitor Android project |
| `docs/` | [Architecture](docs/ARCHITECTURE.md), [API](docs/API.md), [Deployment](docs/DEPLOYMENT.md), [Widget notes](docs/WIDGET.md) |

Stack: React + TypeScript + Vite + Ant Design + FullCalendar; Capacitor 8 (Android); IndexedDB
local-first storage; optional Express + SQLite sync server; offline OCR with PP-OCRv4
(onnxruntime-web).

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — architecture and data flow
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — self-hosting and cross-network sync
- [docs/API.md](docs/API.md) — server API
- [docs/WIDGET.md](docs/WIDGET.md) — widget design notes
- [CHANGELOG.md](CHANGELOG.md) — changes in every release
- [CONTRIBUTING.md](CONTRIBUTING.md) / [SECURITY.md](SECURITY.md)

## FAQ

**The imported timetable is empty.**
The academic system often has not published the new semester yet (during holidays and before term
starts), so an empty result is normal. Try “update timetable” again once it does — and make sure the
semester and the “Monday of week 1” date are correct.

**Where is my data uploaded?**
Nowhere by default: timetable and to-dos stay on your device. Only if you configure an LLM service are
the relevant texts sent to it; only if you enable cross-device sync does data go to the server you
host. Credentials live in the Android Keystore and are deleted when you untick “remember me”.

**Does it work outside Chengdu University of Technology?**
Timetable import is tailored to CDUT's academic system; the calendar, to-dos, scheduling and the
widget do not depend on any school.

**iOS?**
Not supported for now; the focus is Android and the web build.

## License & disclaimer

- Code is released under the [PolyForm Noncommercial License 1.0.0](LICENSE): free to use, modify and
  share, **non-commercial only**. Required Notice: Copyright 2026 ADA-Quart & TyTs.
- This is an **unofficial** student project, not affiliated with Chengdu University of Technology.
  Academic-system data belongs to the university — please follow its rules.
- **About the name.** “日日新” comes from the Book of Rites (苟日新，日日新，又日新). It has **no
  connection** to SenseTime or to its “日日新” (SenseNova) model family; this project is not
  affiliated with or endorsed by SenseTime and does not use its models or services.
- Third-party licenses: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Acknowledgements

- **Special thanks to [kengwang/CDUniTap](https://github.com/kengwang/CDUniTap).** The unified
  authentication (CAS) login and the academic-system timetable fetching in this project reference the
  interface and flow design of that project. No code from it is distributed here, and the timetable
  parser is our own implementation (CDUniTap is GPL-3.0; this project does not include or link it).
- Thanks as well to the open-source projects that make this possible: React, Capacitor, Ant Design,
  FullCalendar, onnxruntime-web, PaddleOCR / PP-OCR, sql.js, ical.js and many others (full list in
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)).

<p align="center"><sub>苟日新，日日新，又日新。</sub></p>
