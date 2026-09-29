# Darwin斗地主

可部署的三人斗地主：标准 / 四癞子、PVE / 房间码 PVP、独立浅色 / 深色主题。规则参考传统欢乐斗地主，并采用本项目明确约定的底牌倍率与带牌规则。

## 本地运行

需要 Node.js 24 或更新版本。

```sh
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173`。默认 API 为 3001，开发服务器转发 API 与 Socket.IO。端口冲突时可以指定：

```sh
PORT=3171 VITE_PORT=5187 ORIGIN=http://127.0.0.1:5187 npm run dev
```

`ORIGIN` 必须与浏览器地址完全一致（协议、主机和端口）；不要在 `localhost` 和 `127.0.0.1` 之间混用。开发模式请设置 `COOKIE_SECURE=false` 或不设置该项。

```sh
npm test
npm run build
ORIGIN=http://127.0.0.1:3001 COOKIE_SECURE=false npm start
```

最后一行启动构建后的同源网页服务。生产环境配置 `NODE_ENV=production`，`ORIGIN` 必填；公网 HTTPS 设置 `COOKIE_SECURE=true`。`npm start` 不自动读取 `.env`，Docker Compose 会读取；直接运行时请显式导出环境变量。

## 已实现

- 现代纸牌、液态玻璃牌桌、浅深主题；手机竖屏双排、横屏单排手牌，点击 / 拖动选牌、取消、键盘操作及减少动态效果。
- 标准与四癞子共用规则引擎。服务器校验牌权、物理手牌、牌型、癞子解释和倍率，客户端不能指定胜负或余额。
- 两名 AI 可分别选谨慎、平衡、激进；使用相同计算预算，只改变策略权重。决策基于自己的手牌、公开出牌、底牌和剩余张数，结合未知牌采样与有限搜索。
- 六位房间码、三人全部准备自动开局；满座加入为观众，非游戏期间可站起 / 坐下，房主离开自动移交。首版不做大厅匹配、账户注册或跨设备找回。
- 主界面与房间底部均可直接编辑昵称，支持对局中修改；新昵称实时同步给同房玩家、观众及同账户的其他窗口。改名保留账户、余额和座位，已结束对局的回放保留结算时的名字。
- 对局中离开判所属阵营负；断线暂停 60 秒，可重连恢复。观众离开不影响对局。服务器重启的未完成对局作废，已经完成的结算持久保存。
- 首次 100 KTokens、底注 10、公共倍数 15 起，不设倍率上限；余额不透支，实际扣款等于实际奖励。破产答题领取 10 KTokens，每次破产都可领取。
- 公开信息提示、倍率明细、独立个人倍率、最近 20 局、赛后全牌逐手复盘与 AI 决策解释。

## 部署

见 [部署与备份说明](docs/DEPLOYMENT.md)。提供单实例 Docker Compose、SQLite 数据卷、Nginx HTTPS / WebSocket 示例和备份脚本。没有内置域名、证书或外部账号依赖。

## 规则和验证

- [完整项目规则](docs/RULES.md)
- [验收记录与限制](docs/ACCEPTANCE.md)
- [接口与代码结构](docs/ARCHITECTURE.md)

每个 PR 和 `main` 的推送都会触发 GitHub Actions：Node.js 24 / 26 测试及构建，然后构建 Docker 生产镜像，在容器服务上验证昵称同步、完整 PVE、四会话 PVP 和 Chromium / WebKit / Firefox 交互。浏览器截图及容器日志随运行记录保存 7 天。

Python Playwright 浏览器脚本为可选验收工具，不是生产依赖：

```sh
python3 -m pip install -r tests/requirements.txt
python3 -m playwright install chromium firefox webkit
GAME_URL=http://127.0.0.1:5173 python3 tests/browser_nickname.py
GAME_URL=http://127.0.0.1:5173 python3 tests/browser_smoke.py
GAME_URL=http://127.0.0.1:5173 python3 tests/browser_pvp.py
GAME_URL=http://127.0.0.1:5173 python3 tests/browser_engines.py
```

浏览器脚本创建独立游客，会产生真实测试战绩；请在测试数据目录中运行。SQLite 默认写入 `data/game.sqlite`，可用 `DATA_DIR` 指定独立目录。不要把生产数据提交到 Git。
