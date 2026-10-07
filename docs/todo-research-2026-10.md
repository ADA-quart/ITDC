# 四象限待办 × 课程时间：研究与实现依据

> 记录 2026-10 这轮「重点从课表转向待办」时的调研结论与设计取舍。
> 结论：**LLM 只负责拆解/排序建议，硬约束由确定性校验器兜底**；待办通过
> `can_do_in_class` 与课程发生关系，课内完成的任务直接融合进对应课程。

## 1. 论文与研究方向

### 四象限与执行心理

- **The Mere Urgency Effect**（Zhu, Yang & Hsee, *Journal of Consumer Research*, 2018）
  <https://academic.oup.com/jcr/article-abstract/45/3/673/4847790>：
  人会优先做"紧急"的任务，即使"重要不紧急"的任务收益更高、甚至紧急是人为制造出来的。
  → 排程顺序必须刻意把"重要不紧急(P2)"放在"紧急不重要(P3)"之前，不能只按 deadline 排。
- **The Illusion of Urgency**（*American Journal of Medicine*, 2023）
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC10159458/>：
  建议用 Eisenhower 矩阵把"建树型"任务与干扰分开，并给重要任务留出被保护的时间。
  → 四象限不能只展示数量，还要给出 Do First / Schedule / Delegate / Eliminate 的行动含义。
- **Implementation Intentions 元分析**（Gollwitzer & Sheeran, 2006）
  <https://doi.org/10.1016/S0065-2601%2806%2938002-1>：
  "如果遇到情境 Y，我就执行动作 Z"的 if-then 计划能显著提升目标达成率。
  → 把待办融合进某节课（if 上这节课，then 做这件事）是有心理学依据的，不是单纯的 UI 装饰。
- **Micro-breaks 元分析**（"Give me a break!", *PLOS ONE*, 2022）
  <https://doi.org/10.1371/journal.pone.0272460>：
  工作间隙的短休息能改善幸福感与表现，且休息越长收益越大；恢复效果与前面的工作负荷相关。
  → 连续 2 小时安排 15 分钟休息是合理区间；课程/日程同样消耗精力，应计入连续工作时长。

### LLM 规划与任务拆解

- **Understanding the planning of LLM agents: A survey**（arXiv:2402.02716）
  <https://arxiv.org/abs/2402.02716>：
  LLM Agent 规划分为 Task Decomposition、Plan Selection、External Module、Reflection、Memory。
  → 我们的定位应该是"外部规划器 + 校验器"，而非让 LLM 直接写最终日历。
- **ADaPT: As-Needed Decomposition and Planning**（arXiv:2311.05772）
  <https://arxiv.org/abs/2311.05772>：
  按需拆解、动态调整粒度，比一次性均匀切分更有效。
- **TaskLAMA**（Google Research）<https://research.google/pubs/tasklama-probing-the-complex-task-understanding-of-language-models/>：
  把复杂任务拆成带时序依赖的 DAG。→ 拆分不只是"按时长切"，理想形态是带顺序的子步骤。
- **LLM+P**（arXiv:2304.11477）<https://arxiv.org/abs/2304.11477>：
  LLM 负责把自然语言转成形式化问题，经典规划器负责求可行解；LLM 本身不可靠地做长程规划。
- **Robust Planning with Compound LLM Architectures (LLM-Modulo)**（arXiv:2411.14484）
  <https://arxiv.org/abs/2411.14484>：LLM 提议 + 外部 verifier 检查，是复杂规划更稳的架构。
- **Human-Centered Planning**（arXiv:2311.04403）<https://arxiv.org/abs/2311.04403>：
  LLMPlan 自反思 + SymPlan 把模糊约束转成符号约束。
- **NATURAL PLAN**（arXiv:2406.04520）<https://arxiv.org/abs/2406.04520>：
  Calendar Scheduling 基准；few-shot 与 self-correction 并不能稳定修复错误，必须有校验。
- **PEARL: Self-Evolving Assistant for Time Management**（arXiv:2601.11957）
  <https://arxiv.org/abs/2601.11957>：
  当前 LLM 处理日历冲突错误率仍很高（示例模型平均 35%），外部偏好记忆/奖励能改善。

**共同结论**：硬约束（不冲突、不超 deadline、工作时段、时长守恒）必须由确定性算法兜底；
LLM 的价值在语义拆解、优先级判断、把"这节课适合做什么"这类模糊信息纳入考虑。

## 2. GitHub 参考项目

- [Appaxaap/Focus](https://github.com/Appaxaap/Focus)：离线 Eisenhower Matrix App
  （Do First / Schedule / Delegate / Eliminate，四象限各自的默认 due date）。
  → 四象限展示采用同样的行动语义。
- [super-productivity/super-productivity](https://github.com/super-productivity/super-productivity)：
  Timeboxing + 日历导入 + 休息计时。→ 排程 = 给任务一个明确的时间盒。
- [fbdo/smart-agentic-calendar](https://github.com/fbdo/smart-agentic-calendar)：
  确定性约束求解（硬约束 + 优先级/专注时段/精力匹配/缓冲等软约束加权），带 at-risk/冲突报告。
  → 提醒我们补上"没排上/排不完"的显式反馈；软约束加权是下一步方向。
- [blackopsrepl/yuga-planner](https://github.com/blackopsrepl/yuga-planner)、
  [sakshiphadatare-creator/Agentic-Academic-Planner](https://github.com/sakshiphadatare-creator/Agentic-Academic-Planner)、
  [rikhil-amonkar/llm-csp](https://github.com/rikhil-amonkar/llm-csp)：
  LLM 做任务分析/拆解，Timefold / OR-Tools CP-SAT / Z3 等求解器做排程，
  并强调"LLM 不能是硬约束的最终裁决者"。与我们的 shared prompt + 本地校验器同构。

## 3. 对现有实现的判断与改动

### 算法拆分

- 原实现：超过 90 分钟按固定 90 分钟等分，尾段可能只有 5 分钟（如 95 → 90+5）。
- 判断：90 分钟上限合理；均匀算术拆分不理解任务结构，但没有 LLM 时是可接受的兜底。
- 改动：尾段不足 15 分钟时从上一段借时间（95 → 80+15）；LLM 提示词要求每段 ≥15 分钟、
  同一待办的分段尽量集中，避免碎片化。

### 算法规划

- 原实现：优先级 + deadline 贪心，工作时段 7:00-23:00，连续 2 小时休息 15 分钟。
- 判断：对个人待办规模足够，确定性、可解释；主要缺口是
  （a）校验只查待办之间的冲突，不查与已有事件的冲突；
  （b）拆分总和与预计时长不校验，"排了一半"也会显示成功；
  （c）课程只在融合时参与，规划时不知道"哪些任务可以排进课里"；
  （d）刚上完课不触发休息。
- 改动：补齐事件冲突校验、拆分完成量校验、未安排任务提示；课程对
  `can_do_in_class=true` 的待办变成弹性时段（整段放进一节课，随后自动融合）；
  连续工作统计把刚结束的课程/日程算进去。

### LLM 调优与提示词

- 原提示词：直接要求输出 JSON 数组，约束偏简略，没有说明课程/课内可做、没有自检步骤，
  也没有提醒模型"别被紧急任务拖走"。
- 判断：让 LLM 直接产出最终方案可以，但必须：低温度、硬约束逐条列出、输出前自检、
  之后由确定性校验器验收；不应把校验失败的结果静默写库。
- 改动：重写 `shared/llm-prompt.ts` 的默认系统提示词（硬约束 / 规划偏好 / 自检 / 示例）；
  课程事件带 `is_class`，待办带 `can_do_in_class`；本地与服务端校验同步升级。
- 模型实测（2026-10-08，同一场景：2 节课 + 1 个会 + 4 条待办）：
  - `deepseek-flash`：18.7s，校验通过，把"背单词"（课内可做）排进 10:00-10:45 的课；
  - `deepseek-v4-pro`：196.8s，校验通过（接近旧的 180s 超时，已把超时放宽到 240s）；
  - `deepseek-chat`：1.2s，但 4 处课表冲突，全部被校验器拦下。
  → 默认 DeepSeek 模型改为 `deepseek-flash`。
  - 思考强度（`reasoning_effort` / `thinking.type=disabled`，DeepSeek 官方 Chat Completions 参数）：
    `flash + low` 9.1s、校验通过；`flash + none` 1.2s、出现 1 处课表冲突被拦下。
    → 设置页提供 关闭/低/高/最高，默认低；关闭档明确提示"可能忽略细节，校验器兜底"。

## 4. 待办 × 课程表逻辑（本轮实现）

- `Todo.can_do_in_class`（默认 false）：待办是否可以在上课时做。
- 新建/编辑待办的复选框；列表里的「课内可做」标签；四象限卡片显示行动含义。
- 拖待办进课程：若未勾选，先弹确认"改成课内可做并融合"，取消则回到原位；
  已勾选则直接融合（沿用整段包含判定与滴水动画）。
- 在课程详情里「加个待办」：课程来源的事件自动勾上课内可做。
- 规划：`can_do_in_class=true` 的待办允许整段排进课程时间，排进去后由既有融合逻辑挂到课程上；
  其它待办仍然把课程当忙碌块。校验器只放行"同一节课内完整包含"的重叠。

## 5. 验证

- `npm run test`：179 通过（含课内排程、最小分段、事件冲突、完成量、未安排提示等新增用例）。
- `npx tsc --noEmit`：干净。
- 真实 DeepSeek 接口按 App 同源提示词 + 校验器跑通（结果见上）。
