# 结构与接口

单实例同源架构：React / Vite 前端，Express HTTP + Socket.IO 服务，Node SQLite。生产网页由同一个 Node 服务的 `dist/` 提供。

| 目录 | 职责 |
| --- | --- |
| `shared` | 牌与类型、牌型解释、候选生成、无网络依赖的回合状态机 |
| `server/rooms.ts` | 座位、授权、版本、计时、断线、个性化状态投影与结算触发 |
| `server/store.ts` | 哈希游客凭证、账户、救济、事务钱包、结算幂等与回放 |
| `server/ai.ts` | 仅接受自己的手牌和公开信息；固定采样 / 搜索预算与人格权重 |
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
| `room.create` | `{mode,kind,personalities:[人格,人格],baseStake?:10\|20\|50}`，缺省 10 | `{ok:true,room}` |
| `room.join` | `{code}` | `{ok:true,room}` |
| `room.command` | `{id,version,command}` | `{ok:true,room,account}` |
| `room.hint` | `{}` | `{ok:true,action,explanation}` |
| 服务端 `room` | 无 | 个性化 `RoomView` 或 `null` |
| 服务端 `account` | 无 | 改名、重置 Tokens 或领取救济后的 `Account`，仅发送给该账户的所有已连接窗口 |

失败 ack 为 `{ok:false,error}`。`id` 为每个动作的 UUID，`version` 为最近收到的房间版本。除独立加倍选择和退出外，过期版本拒绝。重复成功动作不会再次应用。

`command` 包括 `ready`、`stand`、`sit {seat}`、`leave`、`stake {baseStake}`、`game {action}`。`stake` 仅房主可在非游戏期间设置为 10 / 20 / 50，改变数值后清除真人准备状态。`RoomView.baseStake` 是下一次开局的底注，`game.baseStake` 与 `result.baseStake` 是原局固定值。游戏动作包括 `bid {yes}`、`double {yes}`、`pass`、`play {cardIds,as?}`。`as` 与物理牌 ID 一一对应，明确指定癞子替代；客户端不能发送自己的牌面对象代替服务器牌。

`RoomView` 仅包含自己的手牌、公开底牌、公开事件、各座位剩余张数、倍率、计时和结果。底牌与癞子点数在确定地主前隐藏；个人加倍结果在三人决定前隐藏；AI 解释仅赛后进入复盘。完整暗牌状态从不广播。

## 持久化边界

钱包以 TEXT 保存整数，通过 BigInt 运算。一次 `BEGIN IMMEDIATE` 事务完成记账、战绩、回放与结算幂等记录。SQLite WAL 与数据库都位于数据卷，备份需要一致地复制全部文件。

运行中的房间在内存中；不支持多副本共享房间，不提供进行中对局的进程重启恢复。部署时只运行一份服务。未来多实例需外部房间协调与持久事件日志，不能简单增加副本数量。
