# 验收记录

日期：2026-09-30。环境：macOS arm64，本地独立浏览器上下文；Node.js 24.21.0 与开发环境 Node.js 26.3.1。

## 自动化

`npm test`：7 个测试文件、79 项测试通过。覆盖：

- 全部牌型、癞子明确解释、软硬炸等级、带牌限制、底牌最高奖励、叫抢与重发、个人加倍隐私、春天 / 反春天、随机完整对局与牌数守恒。
- 三种 AI 人格的合法动作和实际策略差异、公开信息采样、农民配合、候选超过搜索上限时仍优先找直接出完的手牌。
- 超大整数倍率、余额不足按比例分账、实际收支守恒、重复结算幂等、救济过期与重复领取、账户重新打开后持久化、回放访问权限。
- 三玩家加观众、站起 / 坐下、版本过期和重复动作、隐私投影、断线暂停 / 恢复 / 超时、观众离开不中断、退出判负、重启后旧房间清空。
- 同源 HTTP / Socket 握手、拒绝外国来源、没有 Origin 的同源轮询、非法动作输入；持久化失败时保留原回合状态，可重试完成结算。
- 昵称写入与玩家 / 观众 / 同账户多窗口同步，非法昵称不产生修改；对局中改名保持手牌、计时、座位和余额，历史回放与结算名字不变。
- Tokens 重置固定为 100000：余额高于或低于目标均正确处理，重复请求不累加；事务账目、跨重启持久化、身份与战绩保留、救济题目作废、认证与来源校验、房间内拒绝重置、同账户多窗口同步。

Node 24.21.0 下的 TypeScript 检查、Vitest 和 Vite 生产构建均通过。生产模式单进程服务在本机启动，提供构建后的网页及同源 API / Socket。

## 真实浏览器

| 场景 | 结果 |
| --- | --- |
| Chromium：浅 / 深主页、等待房间、牌桌 | 已截图检查 |
| Chromium：完整癞子 PVE → 结算 → 逐手复盘 | 通过，无 JavaScript 运行错误 |
| 四个隔离 Chromium 会话：三人标准 PVP + 一观众 | 完成真实对局，四端实际结算相同 |
| PVP：满座观战、玩家站起、观众补位 | 通过 |
| 主界面 / PVP 改名、同账户多窗口、观众改名、刷新持久化 | 通过 |
| 主界面 Tokens 重置：SVG 双箭头、两次确认、两种取消、100K 重置、刷新与多窗口同步 | 通过；房间无入口，另一窗口进入房间时关闭旧确认框 |
| PVP：对局中改名与 320px 下的 16 字昵称 | 同房同步，原手牌保留，无横向溢出 |
| PVP：刷新重连 | 同房间、同一手牌恢复，未重复发牌 |
| PVP：确定地主后主动离开 | 其他端立即收到判负结果 |
| PVP：观众赛后全牌回放 | 通过 |
| Chromium / WebKit：390px、320px 竖屏 | 无横向溢出，双排手牌 |
| Chromium / WebKit：844 × 390 横屏 | 单排手牌完整落在可视高度内 |
| Chromium / WebKit：触摸选牌、取消 | 通过 |
| WebKit / Firefox：生产服务身份、联机、PVE、主题、出牌选择与离开 | 通过，无 JavaScript 运行错误 |

对应脚本：`tests/browser_nickname.py`、`tests/browser_smoke.py`、`tests/browser_pvp.py`、`tests/browser_engines.py`。这些脚本使用真实界面和隔离游客身份，Tokens 重置通过玩家可用的正式流程验收，没有测试专用的余额修改后门。

## 截图

- [浅色主界面](screenshots/home-light.png)
- [深色主界面](screenshots/home-dark.png)
- [桌面牌桌](screenshots/table-desktop.png)
- [320px WebKit 牌桌](screenshots/table-mobile.png)
- [手机横屏牌桌](screenshots/table-landscape.png)
- [真实 PVE 结算](screenshots/settlement.png)
- [PVP 昵称入口](screenshots/nickname-pvp.png)
- [320px 长昵称显示](screenshots/nickname-mobile.png)
- [320px 重置首次确认](screenshots/token-reset-first.png)
- [320px 重置最终确认](screenshots/token-reset-second.png)

## 验证边界

- Docker、Docker Compose、Nginx 在本机不可用，本机没有启动这些组件。GitHub Actions 配置了 Linux Docker 构建、数据卷启动和容器内网页的四套浏览器验收，以对应提交的 CI 结果为准；Nginx 与实际 HTTPS 代理仍需部署时验收。
- 尚未指定实际服务器、域名与证书；没有进行公网部署、DNS、HTTPS 或跨公网延迟验收。
- 手机覆盖来自浏览器视口及触摸模拟；WebKit 不是实体 iPhone Safari，未进行实体设备验收。
- 首版为单实例熟人房间游戏，没有大规模并发负载测试。AI 是公开信息下的启发式与有限搜索策略，不承诺专业竞技水平。
- 游客凭证绑定浏览器，清除浏览器数据无法找回；进行中的牌局不跨服务重启恢复。服务升级和停机备份应在没有进行中牌局时安排。
