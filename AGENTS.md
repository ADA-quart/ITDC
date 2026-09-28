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
