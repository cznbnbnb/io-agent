# P41 电脑常驻连接程序（本机验证记录）

> 2026-10-12 复审补充：[质量评估与修复](./phase4-code-quality-review-2026-10-12.md)。本文是原批次记录；“不重复执行/恰好一次”等表述仅适用于当时测试场景，不能推导为真实运行时崩溃恢复保证。当前实现与证据见 agent-bridge README 和 verification/result.json。

日期：2026-10-12。承接[P40 服务端队列](./phase4-message-queue-2026-10-11.md)与[真机同步阻塞记录](./phase3-phone-live-sync-2026-10-11.md)，按[开发顺序](./DEVELOPMENT-PLAN.md)第 7 节 P41 执行：出站连接服务器、在线与可执行状态、掉线补拉、重启恢复、去重和错误对账。此文件记录结果，不替代 DEVELOPMENT-PLAN 或 PRD 验收。

本批新增 `rebuild/agent-bridge/`（无第三方依赖），并与资料服务一起跑真实回环联调。没有真实运行时适配器、没有向真实云端连接、没有读取用户内容；素材为 `docs/contracts/normal.json` 合成对象。

## 1. 实现范围

| 文件 | 作用 |
| --- | --- |
| [bridge.mjs](../../rebuild/agent-bridge/bridge.mjs) | 核心循环：身份/scope 预检、inbox 轮询、适配器动作落地、持久 outbox 发送与对账、等待中的提问复查 |
| [state.mjs](../../rebuild/agent-bridge/state.mjs) | 唯一事实来源：游标、outbox（含完整信封）、已处理账本、答复账本、待答提问；原子写入，损坏即停 |
| [client.mjs](../../rebuild/agent-bridge/client.mjs) | 出站 HTTP：仅 HTTPS（显式放行回环 http）、Bearer 只从私有文件读、不跟随重定向、≤1MiB、单次请求 |
| [cli.mjs](../../rebuild/agent-bridge/cli.mjs) | `once`／`run`／`status`；默认**只观察**适配器（`can_execute=false`），不写任何状态 |
| [verify.mjs](../../rebuild/agent-bridge/verify.mjs) | 证据入口，记录测试项与代码/契约 SHA256 |

关键语义（全部有测试）：

- **只写适配器真正接受的**：默认适配器不产生任何写操作；`task_state` 发布前先读当前头，**状态已相同就不发布**，避免无意义冲突；回执阶段限制在 Agent 可报告的六个阶段，客户端永远不能写 `server_stored`/`expired`。
- **持久 outbox + 同字节重试**：事件在发送前连同 `event_id`/`idempotency_key`/时间戳落盘，重试复用同一份字节，服务端幂等去重成立。
- **丢回复对账**：POST 结果不明（无响应/响应不可解析）时用 `GET /v1/events/{event_id}` 查证；已接受即视为完成，不重复执行。
- **离线与重启**：inbox 游标只在整页处理完后推进；服务不可达时游标不动、outbox 不丢，恢复后恰好补送一次；重启后 `handled` 账本阻止重复处理。
- **永久拒绝即停**：401/403/400/404/409/410 等不可重试错误置 `blocked`（记录 key 与 code）并停止，信封保留给运维处理，不静默丢弃。
- **状态文件损坏即停**：`STATE_CORRUPT`／`STATE_SERVER_MISMATCH` 时不重置游标、不重放队列。
- **提问与答复**：适配器可以创建提问（确定 ID、`revision=1`），程序跟踪并在每轮复查（PRD 的 `glasses.get_reply`）；答复只交付一次，撤回/过期走 `onRequestClosed`。
- 错误输出只有错误码与受限细节：URL、令牌、用户正文都不进入日志或报告。

## 2. 验证结果

| 套件 | 结果 | 覆盖 |
| --- | --- | --- |
| `rebuild/agent-bridge/tests/bridge.test.mjs` | **9/9** | 真实回环服务（真实 SQLite + HTTP）：身份/scope 预检、只观察不写、状态与回执跨重启持久、重试字节一致、丢回复对账、离线游标保持与恰好一次补送、状态文件损坏即停、提问答复一次交付＋回执阶梯、永久拒绝阻塞且保留信封 |
| `rebuild/material-server` 三套件 | **39/39** | 资料 18＋队列 10＋查询 11 回归（含新增 `event_id` 字段） |
| 线上服务 | **7/7** | 重新部署 `store.mjs` 后本机回环 HTTPS 复核：未认证 401、身份绑定、写入 201、重放 200、读回、增量 |

证据：[bridge/verification/result.json](../../rebuild/agent-bridge/verification/result.json)、[material-server/verification/result.json](../../rebuild/material-server/verification/result.json)、[server-live-verification.json](../../rebuild/phase1/server-live-verification.json)。运行环境 Node v22.23.2，本机回环，无 mock 数据库。

## 3. 运行时适配器进程（P42 前置层，已完成）

运行时适配器以**独立进程**接入（`adapter_command`），桥接进程用一行一个 JSON 的请求/响应通信，适配器先声明 `capabilities.can_execute`：

- `can_execute=false` 的适配器无法产生任何写入；静默超时、崩溃、输出非 JSON 一律判失败（`ADAPTER_TIMEOUT`／`ADAPTER_EXITED`／`ADAPTER_PROTOCOL`），**不当作成功**，超时会杀掉该进程。
- 适配器返回的动作**先整体校验再落盘**，坏动作不会留下半截效果（本批测试发现并修正：原先在校验前就已持久化第一个动作）。
- 新增 6 项测试（真实回环服务 + 真实子进程）：能力声明驱动真实写入、不许写、静默/崩溃/非 JSON 都不算成功、违约动作落盘前被拒、停止适配器不留半截效果。

**Hermes 侧接口已定位但未接线**：`<HERMES_HOME>/gateway.sock`（Windows 命名管道）只提供管理动词；会话动词 `session.create`／`session.resume`／`session.activate`／`prompt.submit` 由 `tui_gateway` 的 JSON-RPC 分发器在 Hermes 进程内提供（P11 探针即用此路）。P11 已证实自动续接会重新投递 prompt 形成新问题、旧 live id 与旧 runtime_request_id 不恢复，因此 Hermes 适配器必须先显式选定并验证恢复策略，不能把 auto-continue 当作 `task_resumed`，也不能在恢复失败时悄悄新建会话——**这是下一步 P42 的主体工作**。

## 4. 仍未完成

- **没有真实运行时适配器（P42）**：还没有把任务交给 Hermes 会话、没有 `SESSION_NOT_FOUND`/`execution_unknown` 的真实对账、没有 qids 映射。当前只有测试替身适配器与只观察默认适配器。
- **未连真实云端**：本机出网 443 被云防火墙拦截（见[真机同步记录](./phase3-phone-live-sync-2026-10-11.md)），因此连接程序的真实出站链路未验证；线上 7/7 是服务器本机回环。
- 未验证长时稳定性、断线重连时长、原音与凭据轮换。
- P43（手机文字委托）与 P44（失效和取消）未开始；AC-ASK、AC-DUP、AC-OFF 不据此关闭。

## 5. 下一步

1. 解除 443 防火墙后，先用真机同步打通 P31，再把连接程序指向真实云端做一次端到端（任务→适配器→答复→回执）。
2. P42：落地 P11 已验证的 Hermes 候选路径，明确"恢复指定会话"能力，找不到会话返回错误而不新建替代。
