[English](README.md) | **简体中文**

![Darwin斗地主](docs/branding/readme-banner.webp)

# Darwin斗地主

网页端三人斗地主，可单机与两位 AI 对局，或凭 6 位房间码与好友联机。前端使用 React 19 和 Vite，服务端基于 Express 5、Socket.IO 4 与 Node.js 内置 SQLite。

游戏包含标准、四癞子和天地癞子三种模式。天地癞子在叫地主前亮出天癞子，定地主后再亮出地癞子，最高可打出 12 张长炸。单机对局的两位 AI 可单独改名；难度分恍惚、温和或凌厉，流派分谨慎、平衡或激进。好友房满 3 人准备后自动开局。满座后新进入的成员转为观众，轮到自己出牌可暂停牌局，断线后座位保留 60 秒。

新账户初始余额为 100 KTokens，底注可选 10、20 或 50 Tokens。破产后答题可领 10 KTokens 救济金；不想答题也可以在首页直接把余额重置回 100 KTokens。首页记录最近 20 局战绩并提供全牌面逐手回放。界面支持浅色与深色主题，适配桌面端和手机横竖屏（[桌面牌桌](docs/screenshots/table-desktop.png) · [手机牌桌](docs/screenshots/table-mobile.png)）。

## 本地运行

需要 Node.js 24 或更高版本。

```sh
npm ci
npm run dev
```

浏览器打开 <http://127.0.0.1:5173>。Vite 开发服务器会将 `/api` 和 `/socket.io` 请求转发到本机 `3001` 端口。

端口冲突时可指定端口与访问来源。

```sh
PORT=3171 VITE_PORT=5187 ORIGIN=http://127.0.0.1:5187 npm run dev
```

`ORIGIN` 必须与浏览器地址栏的访问来源完全一致，不要混用 `localhost` 与 `127.0.0.1`。

## 部署

### 直接运行

构建前端后，单个 Node.js 进程会同时提供前端页面与接口服务。

```sh
npm run build
ORIGIN=http://127.0.0.1:3001 COOKIE_SECURE=false npm start
```

生产环境设置 `NODE_ENV=production` 时必须传入 `ORIGIN`。`npm start` 不会自动读取 `.env` 文件，需通过环境变量传入配置。

### Docker Compose

```sh
cp .env.example .env
# 将 .env 中的 ORIGIN 改为公网 HTTPS 地址，如 https://game.example.com
docker compose up -d --build
```

容器默认绑定宿主机 `127.0.0.1:3001`，SQLite 数据库保存在 Docker 命名卷 `landlord-war-data` 中。公网部署需在宿主机配置反向代理以支持 HTTPS 和 WebSocket 升级，配置示例见 [`deploy/nginx.conf`](deploy/nginx.conf)，数据卷备份脚本为 [`deploy/backup.sh`](deploy/backup.sh)。服务重启会结束进行中的未结算牌局。

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3001` | 服务端监听端口 |
| `HOST` | `0.0.0.0` | 服务端监听地址 |
| `ORIGIN` | 开发模式允许本机来源 | 浏览器完整访问来源（如 `https://game.example.com`），`NODE_ENV=production` 时必填 |
| `COOKIE_SECURE` | `NODE_ENV=production` 时为 `true` | 设为 `true` 时仅通过 HTTPS 发送会话 Cookie，本机 HTTP 调试设为 `false` |
| `DATA_DIR` | `data` | SQLite 数据库文件 `game.sqlite` 的存放目录 |

## 测试与文档

```sh
npm test        # 运行 Vitest 单元测试与集成测试
npm run check   # TypeScript 类型检查
npm run build   # 类型检查并构建生产包
```

- [完整规则](docs/RULES.md)
- [AI 难度与流派](docs/AI.md)
- [部署与备份](docs/DEPLOYMENT.md)
- [结构与接口](docs/ARCHITECTURE.md)
- [验收记录](docs/ACCEPTANCE.md)

## 关于

作者为 Alex Xiao，OpenAI [Codex](https://github.com/codex) 与 ChatGPT 参与了代码实现（Vibe Coding）。

[MIT 许可证](LICENSE) · [项目图标](docs/branding/logo.png)
