# ![Darwin斗地主](docs/branding/readme-banner.webp)

在浏览器里打三人斗地主。一个人可以和两位 AI 开局，和朋友玩时用六位房间码入座。

## 怎么玩

- **选玩法**。支持标准、四癞子和天地癞子。天地癞子在叫地主前亮出天癞子，确定地主后再亮出地癞子，可打出最多十二张牌的长炸。[查看完整规则](docs/RULES.md)
- **和 AI 打**。两位 AI 的昵称、难度和流派可以分别设置。AI 根据自己的手牌和牌桌上的公开信息出牌。[查看 AI 策略](docs/AI.md)
- **开好友房**。三人准备后自动开局，满座后可观战。轮到自己出牌时可以暂停整桌，由暂停的人继续。断线后有 60 秒重连时间。
- **复盘牌局**。赛后可以查看全桌手牌、逐手回放和倍率明细。首页保留最近 20 局。

底注可选 10、20 或 50 Tokens。余额用完可以答题领取 10 KTokens，也可以在首页重置余额。

牌桌支持浅色和深色主题，手机竖屏时手牌分两排，横屏时排成一行。[桌面牌桌](docs/screenshots/table-desktop.png) · [手机牌桌](docs/screenshots/table-mobile.png)

## 本地运行

安装 Node.js 24 或更新版本，在项目根目录运行。

```sh
npm ci
npm run dev
```

打开 <http://127.0.0.1:5173>。Vite 将 API 和 Socket.IO 请求转发到本机 3001 端口。如需换端口，可同时设置后端端口、Vite 端口和浏览器来源。

```sh
PORT=3171 VITE_PORT=5187 ORIGIN=http://127.0.0.1:5187 npm run dev
```

`ORIGIN` 要与浏览器地址的协议、主机名和端口一致。本机使用 HTTP 时可设置 `COOKIE_SECURE=false`。

## 部署

安装依赖后，可构建并在本机启动由 Express 提供的单端口服务。

```sh
npm run build
ORIGIN=http://127.0.0.1:3001 COOKIE_SECURE=false npm start
```

公开部署可使用仓库自带的 Docker Compose 和 Nginx 示例。将 `ORIGIN` 设为玩家实际访问的 HTTPS 来源，并启用 `COOKIE_SECURE=true`。直接启动生产服务时设置 `NODE_ENV=production`，并通过环境变量提供配置。Compose 会读取 `.env`。

SQLite 保存余额和已结算的对局，服务重启会结束尚未结算的牌局。[部署与备份说明](docs/DEPLOYMENT.md) · [接口与代码结构](docs/ARCHITECTURE.md)

## 验证

本地运行 `npm test` 和 `npm run build`。每个 PR 和 `main` 的推送都会触发 CI，在 Node.js 24 和 26 上测试和构建，再用 Docker 生产镜像验证单人和联机对局，以及 Chromium、WebKit 和 Firefox 上的交互。

验收记录附有测试脚本、截图和覆盖范围。浏览器脚本会创建游客与测试战绩，运行时请用独立的 `DATA_DIR`。[验收记录](docs/ACCEPTANCE.md) · [GitHub Actions](https://github.com/Alexme9125/landlord-war/actions/workflows/ci.yml)

## 关于

项目作者为 Alex Xiao。OpenAI 的 Codex 参与项目实现。本项目采用 Vibe Coding，ChatGPT 协助代码编写与改进。[Codex](https://github.com/codex)

[MIT 许可证](LICENSE) · [项目图标（PNG）](docs/branding/logo.png)
