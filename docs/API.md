# API 参考

服务端默认监听 `3000` 端口（`PORT` 可改），所有接口挂在 `/api` 下。

**这些接口在「仅本机」模式下完全不会被调用** —— 那种情况下所有数据操作都在客户端完成。
只有在启用了跨设备同步、或用浏览器访问服务器地址时才会用到。

无鉴权，见 [SECURITY.md](../SECURITY.md)。

## 健康检查

```
GET /api/health
```

返回 `{ "status": "ok", "version": "...", "serverTime": "..." }`。
设置页用它判断地址是否为有效的 ITDC 服务。

## 日历与事件

挂载在 `/api/calendar`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/calendars` | 列出全部日历 |
| POST | `/calendars` | 新建日历 |
| DELETE | `/calendars/:id` | 删除日历及其下全部事件 |
| GET | `/events` | 列出事件，支持 `start` / `end` 范围过滤 |
| POST | `/events` | 新建事件 |
| PUT | `/events/:id` | 更新事件 |
| DELETE | `/events/:id` | 删除事件 |
| POST | `/import` | 导入 iCal 文件（multipart，字段名 `file`） |
| GET | `/export-week` | 导出本周为 Excel（查询参数 `lang`） |
| GET | `/export-ical` | 导出全部为 .ics（查询参数 `lang`） |

> 客户端侧的 iCal 与 Excel 处理是**本地实现**（`src/api/local-ical.ts`、`src/api/local-excel.ts`），
> 不依赖这些接口。服务端保留同名能力是为了兼容直接调用 API 的场景。

## 待办

挂载在 `/api/todos`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 列出待办，支持 `status` / `priority` 过滤 |
| POST | `/` | 新建待办（自动计算四象限优先级） |
| PUT | `/:id` | 更新待办 |
| DELETE | `/:id` | 删除待办 |
| POST | `/:id/split` | 按时间段拆分为多条 |
| POST | `/nl` | 自然语言解析并创建（需已配置 LLM） |

## 排程

挂载在 `/api/schedule`。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/generate` | 生成排程方案，body 为 `{ mode: 'algorithm' \| 'llm' }` |
| POST | `/apply` | 应用方案，body 为 `{ schedule: [...] }` |
| GET | `/llm-config` | 列出 LLM 配置（不含 API Key 明文） |
| POST | `/llm-config` | 新增配置 |
| PUT | `/llm-config/:id/activate` | 启用某配置 |
| DELETE | `/llm-config/:id` | 删除配置 |
| POST | `/llm-config/test` | 测试连通性 |
| GET | `/prompt-template` | 读取自定义提示词 |
| PUT | `/prompt-template` | 保存自定义提示词 |
| POST | `/prompt-template/reset` | 重置为默认提示词 |
| GET | `/debug-log` | 读取调试日志（**仅允许本机访问**） |
| DELETE | `/debug-log` | 清空调试日志（**仅允许本机访问**） |

> `algorithm` 模式客户端有本地实现，不必须走服务端。`llm` 模式必须走服务端（客户端不内置模型）。

## 同步合并

挂载在 `/api/sync`。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/merge` | 合并两端数据 |

请求体：

```jsonc
{
  "todos":     [ /* 含 sync_uid、updated_at */ ],
  "calendars": [ /* 同上 */ ],
  "events":    [ /* 同上，另需 calendar_uid 指向所属日历 */ ],
  "deleted": {
    "todos":     ["被删除记录的 sync_uid"],
    "calendars": [],
    "events":    []
  }
}
```

响应返回合并后的**全量**数据（`todos` / `calendars` / `events`）、全部墓碑，以及本次的 `stats`
（`added` / `updated` / `removed`）。

合并规则见 [ARCHITECTURE.md](ARCHITECTURE.md#合并同步)。

## 小组件数据

挂载在 `/api/widget`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/today` | 今日已排期 + 待办 Top5，供同步模式下的桌面小组件拉取 |

> 仅本机模式下小组件不走这个接口，改由 App 推送快照，见 [WIDGET.md](WIDGET.md)。

## 设置

挂载在 `/api/settings`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/:key` | 读取设置项 |
| PUT | `/:key` | 写入设置项 |

允许的 key：`language`、`theme`、`llm_prompt_template`。其它 key 返回 400。

## 错误格式

错误统一返回 JSON：

```json
{ "error": "错误说明" }
```

未匹配的 `/api/*` 返回 `404`，不会落入前端路由的 HTML 回退 —— 这点很重要，
否则客户端会把 HTML 当成数据解析（曾导致过数据损坏，见 `src/api/offline.ts` 的响应校验）。
