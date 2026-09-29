# 贡献指南

欢迎提 issue 和 PR。这个项目由个人维护，我会尽量回复，但不保证时效。

## 开发环境

```bash
git clone https://github.com/ADA-quart/ITDC.git
cd ITDC
npm install
npm run dev:all     # 前端 5173 + 后端 3000
```

需要 Node.js ≥ 18。Android 相关开发另需 JDK 21 与 Android SDK（compileSdk 36）。

## 提交前必须通过

```bash
npx tsc --noEmit    # 类型检查
npx vitest run      # 单元测试
npm run build       # 前端构建
```

改了 `server/` 或 `plugins/` 的话，再跑一次服务端启动，确认数据库迁移没报错：

```bash
npm start
```

## 代码约定

**提交信息**用中文，一句话说清「改了什么 / 为什么」。不要写 `fix bug` 这种。

**文件格式**由 `.editorconfig` / `.gitattributes` 统一（LF 换行、2 空格缩进；Java 与 XML 4 空格）。IDE 支持这两份配置的话不用手动调。

**注释**只在「为什么」不明显时写。这个项目里已有的注释大多在解释踩过的坑（比如 RemoteViews 的权限限制、IndexedDB 的版本事务），保留它们。

**README 有两份**：`README.md`（简体中文）与 `README.en.md`（英文）。修改时请同步更新两份，
保持章节结构一致 —— 两份的二级/三级标题应一一对应，顶部互相链接。

## 改这几处时请特别小心

### 数据层（`src/api/`）

项目的核心设计是**本地优先**：数据以客户端 IndexedDB 为第一数据源，服务器是可选镜像。
新增写操作时，不要在失败路径上直接抛错中断用户操作 —— 应该落到本地并让后续同步兜底。

### 同步合并（`server/routes/sync.ts`）

合并按 `sync_uid` 匹配，不看自增 id（两端 id 空间不一致，按 id 对齐会错配数据）。
新增可同步的实体时，必须同时给出 `sync_uid` 与 `updated_at`，否则合并时会被跳过。

### 小组件（`plugins/itdc-widget/`）

两个反复踩到的限制：

- RemoteViews **只允许白名单控件**。用 `<View>` 画分隔线会抛 `Class not allowed`，必须用 `ImageView`。
- 集合型小组件里子项**不能**用 `setOnClickPendingIntent`（会被忽略），必须 `setPendingIntentTemplate` + `setOnClickFillInIntent`，且模板 PendingIntent 要用 `FLAG_MUTABLE`。

### 构建 APK

顺序不能省。只跑 `gradlew assembleDebug` 不会重新打包前端资源：

```bash
npm run android:sync    # 内含 build:native，会替换 Service Worker 为清理脚本
cd android && ./gradlew assembleDebug
```

`build:native` 会把 PWA 的 Service Worker 换成「自杀式」脚本 —— 否则 APK 升级后 WebView 仍从缓存加载旧 JS，表现为「装了新版但功能没变」。

## PR 要求

- 一个 PR 只做一件事，便于回滚
- 说明**为什么**改，而不只是改了什么
- 涉及 UI 的附截图（手机端请说明屏幕宽度）
- 不要提交 `dist/`、`data/`、`.tmp_*`、构建产物、APK（已在 `.gitignore` 中）

## 关于「屎山」

这个项目从零散脚本长起来，中途经历过一次架构转向（服务器权威 → 本地优先），留过一些死代码。
如果你发现明确的死代码或重复实现，欢迎单独提 PR 清理 —— 但请**先确认无引用**，并说明依据。
