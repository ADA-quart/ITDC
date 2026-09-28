# 部署说明：云端（Railway / Render / Fly.io）+ Docker

> 目标：手机与电脑**不再依赖同一局域网** —— 让所有设备都连到同一个公网服务地址。
> 部署完成后，在 App「设置 → 通用设置 → 服务器地址」填 `https://你的域名/api`，两端即可跨网络同步。

## 1. 本地构建验证
```bash
npm run build && npm start
# 浏览器开 http://localhost:3000 ，/api/health 返回 {"status":"ok",...} 即成功
```

## 2. 跨网络同步的三种方式

| 方式 | 适用 | 前端地址填写 |
|------|------|--------------|
| 公网服务器 / 云平台 | 手机在任何网络都能用（推荐） | `https://你的域名/api` |
| 内网穿透（Cloudflare Tunnel / frp / ngrok） | 不想买服务器，从家里电脑直接暴露 | `https://分配到的域名/api` |
| 家用局域网 | 仅在家用，无需公网 | `http://电脑IP:3000/api` |

### 2.1 内网穿透（最快，无需买服务器）
```bash
# Cloudflare Tunnel 示例：把本机 3000 端口暴露成 https 域名
cloudflared tunnel --url http://localhost:3000
# 输出的 https://xxxx.trycloudflare.com 即为前端可填地址（后面加 /api）
```

## 3. Railway（推荐云平台）
- 新建 Project → Deploy from GitHub repo (ADA-quart/ITDC)
- Build command：`npm ci && npm run build`
- Start command：`npm start`
- 环境变量：
  - `CRYPTO_SECRET` = 用 `openssl rand -hex 32` 生成（**生产必填**，否则拒绝启动）
  - `DB_PATH` = `/data/calendar.db`（挂 Persistent Volume 到 `/data`，防止重新部署丢数据）
  - `CORS_ORIGINS` = 前端域名（如果用独立前端域名访问；同源部署可留空）

## 4. Render / Fly.io
- 同 Railway：Build `npm ci && npm run build`，Start `npm start`
- 需挂持久存储/卷给 `DB_PATH`；Render 的 Static Site 不能跑 Express API，请用 Web Service（Node）
- Fly.io：`fly launch` + `fly secrets set CRYPTO_SECRET=xxx`

## 5. VPS + Docker（完全自管）
```bash
# 1) 生成强密钥并写入 .env
echo "CRYPTO_SECRET=$(openssl rand -hex 32)" >> .env
# 2) 启动（compose 已内置持久卷与重启策略）
docker compose up -d
# 访问 http://你的公网IP或域名:3000
```
建议在前面加 Nginx/Caddy 终止 TLS，对外只暴露 443（见第 7 节）。

## 6. 各端连接方式
- **浏览器**：直接访问服务地址即可（同源，无需配置）
- **APK / PWA**：设置页 → 服务器地址 → 填 `https://你的域名/api` → 保存并测试
- **桌面小组件**：在 App 内保存服务器地址后自动同步；升级后首次启动也会自动推送一次

> `CORS_ORIGINS` 说明：同源部署（浏览器直接开服务地址）留空即可；只有当前端与 API 分属不同域名时才需要填写，多个用逗号分隔。

## 7. HTTPS / 域名
- Railway / Render 自带免费 HTTPS + 自定义域名
- 用 Cloudflare Tunnel / Caddy 可零配置获得证书：
  ```
  # Caddyfile
  itdc.example.com {
      reverse_proxy localhost:3000
  }
  ```
- **手机端务必用 https 地址**：Android 9+ 默认禁止明文 http，且 https 不受网络切换影响

## 8. 数据持久化注意
SQLite 是本地文件（`data/calendar.db`）。云端必须挂卷/持久盘；
否则重新部署后日历、待办、LLM 配置会全丢。备份 = 定期把 `calendar.db` 拉下来。

## 9. 安全提醒
- 服务暴露公网后，任何知道地址的人都能读写数据 → 建议加一层访问控制（反向代理 Basic Auth、Cloudflare Access 等）
- `CORS_ALLOW_ALL=1` 仅建议在纯内网使用，公网服务请改用 `CORS_ORIGINS` 白名单