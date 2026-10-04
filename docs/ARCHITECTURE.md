# 结构与接口

单实例同源架构：React / Vite 前端，Express HTTP + Socket.IO 服务，Node SQLite。生产网页由同一个 Node 服务的 `dist/` 提供。

| 目录 | 职责 |
| --- | --- |
| `shared` | 牌与类型、牌型解释、候选生成、无网络依赖的回合状态机 |
| `server/rooms.ts` | 座位、授权、版本、计时、断线、个性化状态投影与结算触发 |
| `server/store.ts` | 哈希游客凭证、账户、救济、事务钱包、结算幂等与回放 |
| `server/ai.ts`、`ai-planner.ts`、`ai-strategy.ts` | 公开信息决策；保留恍惚，新增分组规划、可能牌面采样与阵营搜索 |
| `server/app.ts` | HTTP、Cookie、来源验证、流量限制、Socket 事件和静态文件 |
| `src` | 双主题布局、牌桌交互、手牌手势、倍率、结算和复盘 |

## HTTP

所有金额是十进制字符串。除健康检查、首次创建身份外，都要求 `clear_session` HttpOnly Cookie。写请求要求匹配来源；身份凭证不暴露到 JavaScript，数据库仅保存其哈希。

| 接口 | 输入 / 返回 |
| --- | --- |
| `GET /api/health` | `{ok:true}` |
| `POST /api/session` | 恢复或创建游客；返回 `{account,roomCode}`，首次设置 Cookie |
| `GET /api/me` | `{id,name,balance,games,wins}` |
| `PATCH /api/me` | `{name}`，在主页或房间修改 1–16 个 Unicode 字符的昵称，允许对局中修改；同步当前座位、观众列表及账户，不修改历史回放 |
| `POST /api/me/reset-tokens` | `{confirmed:true}`，仅未加入房间的当前账户可用，将余额设为 100000 并返回 `Account`；在同一事务中记录 `reset` 账目并作废未使用的救济题目 |
| `GET /api/history` | 最近 20 局 `{id,mode,kind,at,delta,won}` |
| `GET /api/replays/:id` | 完整终局、初始牌、逐步动作和 AI 解释；仅参与者，或仍在已结束房间的观众 |
| `POST /api/relief` | 零余额领取题目 `{id,question}` |
| `POST /api/relief/claim` | `{id,answer}`；答对后原子增加 10000，返回 account 并同步同账户窗口；答错返回 400 `{error,challenge:{id,question}}`，旧题作废与新题生成同一事务提交，客户端清空答案并继续展示新题 |

失败返回合适 HTTP 状态及 `{error}`，正文不超过 16KB。该原型为熟人房间服务，不提供实名身份、排行榜经济防刷或跨设备账户找回。

## Socket.IO

握手验证来源及 Cookie。浏览器同源轮询可能没有 Origin，此时只接受 `Sec-Fetch-Site: same-origin`；有外国来源时仍拒绝。重连会立即发送当前房间，服务重启失去房间时发送 `null`，防止旧牌桌继续显示为有效。

| 事件 | 客户端参数 | ack |
| --- | --- | --- |
| `room.create` | `{mode,kind,bots?:[{name,difficulty,personality},{name,difficulty,personality}],baseStake?:10\|20\|50}`，缺省 10 | `{ok:true,room}` |
| `room.join` | `{code}` | `{ok:true,room}` |
| `room.command` | `{id,version,command}` | `{ok:true,room,account}` |
| `room.hint` | `{}` | `{ok:true,action,explanation}` |
| 服务端 `room` | 无 | 个性化 `RoomView` 或 `null` |
| 服务端 `account` | 无 | 改名、重置 Tokens 或领取救济后的 `Account`，仅发送给该账户的所有已连接窗口 |

失败 ack 为 `{ok:false,error}`。`id` 为每个动作的 UUID，`version` 为最近收到的房间版本。除独立加倍选择和退出外，过期版本拒绝。重复成功动作不会再次应用。

`mode` 可选 `standard`、`wild`、`heaven-earth`。三个模式共用房间、结算与回放格式。

`bots` 必须包含两个配置，名字遵循玩家昵称的 1–16 Unicode 字符规则。`difficulty` 是 `dazed`（恍惚）、`gentle`（温和）、`fierce`（凌厉）；`personality` 是 `cautious`、`balanced`、`bold`。UI 默认两位温和，配置保存在 `darwin-bots` 浏览器偏好中。旧客户端的 `personalities:[人格,人格]` 仍兼容，缺省使用原名字、原流派和恍惚策略；旧提示及超时建议调用也保留原策略。配置非法时在创建房间前拒绝，不能部分创建。座位以 `bot` 表示流派，新增可选 `difficulty`，下一局及赛后回放保留配置，旧回放无该字段时兼容。

`command` 包括 `ready`、`stand`、`sit {seat}`、`leave`、`stake {baseStake}`、`pause`、`resume`、`game {action}`。`stake` 仅房主可在非游戏期间设置为 10 / 20 / 50，改变数值后清除真人准备状态。`RoomView.baseStake` 是下一次开局的底注，`game.baseStake` 与 `result.baseStake` 是原局固定值。游戏动作包括 `bid {yes}`、`double {yes}`、`pass`、`play {cardIds,as?,kind?,main?}`。`as` 与物理牌 ID 一一对应；`kind/main` 指定有歧义时的牌型与主体，服务器只接受这些牌确实能组成的解释。客户端不能发送自己的牌面对象代替服务器牌。

`pause` 仅限出牌阶段的当前真人，且截止时间尚未到达；服务端保存 `deadline - Date.now()` 的剩余毫秒并清空截止时间。`RoomView.pause` 为 `null` 或 `{by: accountId, remainingMs}`，对玩家与观众一致；`pausedUntil` 继续表示独立的断线保留截止时间。手动暂停期间拒绝游戏动作与提示，跳过自动出牌和 AI 调度；只有暂停者可 `resume`，并且所有在座玩家必须在线。恢复将截止时间设为当前时间加剩余毫秒。版本验证与命令去重同样适用，重新连接不解除手动暂停；断线超时与主动退出仍按原规则结算，并清除暂停状态。

`RoomView` 仅包含自己的手牌、公开底牌、公开事件、各座位剩余张数、倍率、计时和结果。`heavenRank` 为天地模式的天癞子，发牌后公开；`wildRank` 为四癞子点数或天地模式的地癞子，与底牌一起在确定地主后公开。其他模式的 `heavenRank` 为 `null`，旧回放没有该字段时按无天癞子处理。AI 使用同样的公开范围。个人加倍结果在三人决定前隐藏；AI 解释仅赛后进入复盘。完整暗牌状态从不广播。

隐式癞子解释按合法主体与翼牌模板匹配，避免八张癞子逐一枚举替代点数。牌型、主体点数和长度相同的解释保留一种尽量使用原点数的翼牌组合；显式 `as` 仍完整验证。提示与 AI 支持两种癞子、长炸及混合癞子炸，先扫描直接收尾候选，再进行有上限的策略评分。

## 持久化边界

钱包以 TEXT 保存整数，通过 BigInt 运算。一次 `BEGIN IMMEDIATE` 事务完成记账、战绩、回放与结算幂等记录。SQLite WAL 与数据库都位于数据卷，备份需要一致地复制全部文件。

运行中的房间在内存中；不支持多副本共享房间，不提供进行中对局的进程重启恢复。部署时只运行一份服务。未来多实例需外部房间协调与持久事件日志，不能简单增加副本数量。
