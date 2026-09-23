# 部署说明：云端（Railway / Render / Fly.io）+ Dockerfile

## 1. 本地构建验证
npm run build && npm start
# 浏览器开 http://localhost:3000 ，/api/health 返回 {"status":"ok"} 即成功

## 2. Railway（推荐，最快）
- 新建 Project → Deploy from GitHub repo (ADA-quart/ITDC)
- Build command: 
pm ci && npm run build
- Start command: 
pm start
- 环境变量：
  - CRYPTO_SECRET = 用 openssl rand -hex 32 生成（必填，否则启动拒绝）
  - DB_PATH = /data/calendar.db（挂一个 Persistent Volume 到 /data，防止重新部署丢数据）

## 3. Render / Fly.io
- 同 Railway：build 
pm ci && npm run build，start 
pm start
- 需挂持久存储/卷给 DB_PATH；Render 的 Static Site 不能跑 Express API，用 Web Service（Node）
- Fly.io: fly launch + fly secrets set CRYPTO_SECRET=xxx

## 4. VPS + Docker（完全自管）
见 /Dockerfile 与 docker-compose.yml：
docker compose up -d
# 访问 http://你的公网IP或域名:3000

## 5. 手机端连接
APK / PWA → 设置页 → 服务器地址填 http://<公网IP>:3000/api（或 https 域名 + /api）→ 保存并测试

## 6. 数据持久化注意
SQLite 是本地文件（data/calendar.db）。云端必须挂卷/持久盘；
否则重新部署后日历、待办、LLM 配置会全丢。备份 = 定期把 calendar.db 拉下来。

## 7. HTTPS / 域名
- Railway/Render 自带免费 HTTPS + 自定义域名
- 手机端用 https 域名最稳（APK 的 WebView 对 http 有警告）
