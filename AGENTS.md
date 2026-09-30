# AGENTS.md — ITDC 项目 Codex 工作约定

> 适用：本仓库及其所有 Codex worktree / 本地克隆。本地模型与云端模型都适用。

## 1. 防死循环（硬规则，优先级最高）

1. **同一个命令 / 同一个工具调用最多执行 2 次。** 第二次的返回与第一次相同
   （`Everything up-to-date`、`Already up-to-date`、同样的报错、同样的文件列表）
   → **立即停止调用工具**，一句话给结论。
2. **`git push` 返回 `Everything up-to-date` = 推送已经成功**，禁止再推。
   要确认就核对一次：`git log --oneline -1` 与 `git ls-remote origin refs/heads/main`
   的前 7 位一致即完成。
3. **只读命令不得连续重复**：`git log/status/show/diff`、`ls`、`Get-Content`/`cat`、`rg` ——
   文件没被改动过，就不需要看第二遍。
4. **连续 3 次工具调用输出完全相同 = 卡住了**：停止，输出「已完成 / 卡在哪里 / 需要用户做什么」，
   不要继续尝试同一件事。
5. **构建、测试、部署类命令最多跑 2 次**；第 3 次之前必须说明"这次和上次有什么不同"。
6. 每次调用工具前自问一句：**这次调用会带来新信息吗？** 不会 → 不调用，直接作答。

7. **空输出 = 有效答案，不是"还没好"。** 下列结果拿到即下结论、**禁止重跑**：
   - `git log A..B -- path` 没有输出 → 该范围内**该路径没有改动**；
   - `git log` / `git diff` / `rg` / `Select-String` 无匹配 → **没有**，直接回答"没有"；
   - 命令退出码 0、输出为空 → 命令**成功且无内容**，不要换写法再试。
   凡是"输出为空 → 我再跑一遍确认"的行为一律算卡死。

## 2. 仓库约定

- 远端 `origin` = <https://github.com/ADA-quart/ITDC.git>，主分支 **main**。
- Codex worktree 常常处于 detached HEAD，推送用 `git push origin HEAD:refs/heads/main`，
  推完按第 1 条核对一次即可（不要再推第二次）。
- 不要提交临时物：`.ci_log*.zip`、`.ci_logs/`、`*.log`、构建产物；需要留存证据请写进提交说明或 `docs/`。
- 提交信息用一句中文说明「改了什么 / 为什么」。

## 3. 输出风格

- 结论先行，然后列改动文件与验证方式；不要复述工具输出全文。
- 报错贴关键几行即可，不要贴整段日志。
- 不确定时选最小可行动作，并明确写出「存疑点 + 打算怎么验证」。

## 4. 发布节奏（硬规则）

**不要主动升版本号、打 tag、发 Release。** 版本号涨得太快会变成噪音，
维护者要留内部测试期。

- 平时改动：只记到 `CHANGELOG.md` 的 `## [Unreleased]` 段落，版本号三处保持不动。
- 默认**只提交到本地**，不推远端。用户明确说「推」「发版」时才推送。
- 用户说「内部测试」时：最多构建本地 debug APK 交付（`android/app/build/outputs/apk/debug/app-debug.apk`），
  不碰远端任何东西。
- 用户喊「推 / 发版」时，按顺序执行：
  1. `[Unreleased]` 改成 `## [x.y.z] - YYYY-MM-DD`
  2. 同步三处版本号（`package.json`、`capacitor.config.json`、`android/app/build.gradle`，`versionCode` +1）
  3. `git push origin HEAD:refs/heads/main` → `git tag vX.Y.Z` → `git push origin vX.Y.Z`
- 版本号语义：功能升 minor，修 bug 升 patch，破坏性变更升 major。
