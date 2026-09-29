# 部署与备份

本项目使用 Docker Compose 启动一个 Node 服务，前端静态文件由 Express 提供，API 和 Socket.IO 共用同一端口。生产环境建议在主机 Nginx 上终止 HTTPS；Compose 只把服务绑定到主机的 `127.0.0.1:3001`。

## 启动

服务器需要安装 Docker Engine 和 Docker Compose 插件。进入 `landlord-war` 目录，复制并编辑环境文件：

```sh
cp .env.example .env
```

把 `ORIGIN` 改成玩家实际访问的完整来源，例如 `https://game.example.com`，包含协议和端口（如有），不要包含路径。经 HTTPS 对外服务时保留 `COOKIE_SECURE=true`。

构建并启动：

```sh
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3001/api/health
```

查看启动日志：

```sh
docker compose logs --tail=100 -f landlord-war
```

健康检查访问 `/api/health`。SQLite 数据保存在 Docker 命名卷 `landlord-war-data`，容器重建不会清除此卷。不要用 `docker compose down -v`，它会删除游戏数据。仅在本机临时 HTTP 验收时，才把 `.env` 中的 `ORIGIN` 设为本机地址并将 `COOKIE_SECURE` 设为 `false`；公网部署应使用 HTTPS 和安全 Cookie。

## Nginx 与 HTTPS

`deploy/nginx.conf` 提供了 HTTPS、长连接和 Socket.IO WebSocket 升级所需的反向代理配置。将其中的 `game.example.com` 和证书路径替换为自己的值，再由主机 Nginx 在 `http {}` 配置上下文加载。示例证书路径只是占位符；本项目没有申请或配置 TLS 证书。应先为域名取得有效证书，再启用该站点配置。

反向代理应与 Docker 服务运行在同一台主机，因为容器只监听主机回环地址。如果代理部署在另一台机器，需要有意调整端口绑定和网络访问规则。

## 备份

运行备份脚本：

```sh
./deploy/backup.sh
```

默认把压缩归档写到项目目录的上一级 `landlord-war-backups/`。也可以传入备份目录：

```sh
./deploy/backup.sh /srv/backups/landlord-war
```

脚本会短暂停止正在运行的服务，归档命名卷中的 SQLite 文件，再恢复服务原来的运行状态。停机将作废未完成的对局，请在无人对局时执行。请把备份复制到独立磁盘或异地存储。

## 恢复

恢复会替换命名卷的全部内容。先保留一份当前备份，并确认归档文件名无误。以下示例使用备份脚本默认生成的上一级 `landlord-war-backups/` 目录：

```sh
docker compose stop landlord-war
docker run --rm -i \
  -v landlord-war-data:/data \
  -v "$PWD/../landlord-war-backups:/backups:ro" \
  alpine:3 sh -c \
  'find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar -xzf "/backups/$1" -C /data' \
  sh landlord-war-YYYYMMDDTHHMMSSZ-PID.tar.gz
docker compose start landlord-war
```

将最后一个参数替换成实际归档文件名。恢复后确认健康检查通过，再由浏览器进入游戏。

## 上线验收

检查 `/api/health` 返回成功，并从公网 HTTPS 地址分别用三个隔离浏览器或设备加入同一房间并全部准备，另用一个观众会话检查隐私，完成一整局对局与结算，以确认 Socket.IO 长连接可用。游客身份不会跨设备同步；服务重启会使未完成的对局作废。
