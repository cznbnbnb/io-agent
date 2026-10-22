# P41 电脑常驻连接程序（本机验证版）

只出站的连接程序：轮询服务器的资料/队列接口，把任务与消息交给**运行时适配器**。默认不执行任务；配置 `adapter_command` 后启动该适配器子进程。Hermes 本机真实模型接线已验证，生产身份和手机云端接线仍待验收。2026-10-12 复审见[质量评估](../../docs/product/phase4-code-quality-review-2026-10-12.md)。

后续进展：Hermes 的 skill + 固定 CLI 适配已通过真实模型、本机合成队列的原任务问答、忙时排队、运行中/排队取消、取消后继续及正常重启，见[实际验证范围](../../docs/product/phase4-hermes-cli-provider-2026-10-12.md)。这不关闭 P42 的生产接入及 P43/P44 手机云端验收。

2026-10-13：r2 已真实部署，Hermes 固定 CLI 经公网 HTTPS 队列完成原任务续答、排队、取消及正常重启；修复中断空正文误判 unknown。手机角色由电脑合成测试驱动代发，测试凭据已撤销，手机/眼镜端到端仍待验收。见[云端集成及失败证据](../../docs/product/phase4-cloud-hermes-2026-10-13.md)。

运行时不明结果已有独立[只读检查/明确对账CLI](../../docs/product/phase4-runtime-reconciliation-2026-10-12.md)，实际ACP子进程异常退出、合成裁决、重启传输和后续任务继续已通过。它不自动重放原任务。bridge 首次 queued 任务有[接收查证](../../docs/product/phase4-intake-reconciliation-2026-10-12.md)，原问题的答案另有[只读接收查证](../../docs/product/phase4-answer-intake-reconciliation-2026-10-13.md)。取消/关闭等其他 DISPATCH_UNCERTAIN 及丢失的工具调用栈仍不恢复。

## 运行

新服务器可通过 identity 的 `request_lifecycle_v1` 让电脑按原问题 ID/版本收口过期与关闭父任务的问题。丢回包保留等待记录，同版本重试；不会重新提问或宣称任务已取消。原 GET 轮询兼容旧服务器；本扩展已部署到云端，并通过隔离 owner 的公网裁决验证。见[契约、实际过期等待与真实模型撤回验证](../../docs/product/phase4-request-lifecycle-2026-10-12.md)。

Node **22.18–22.x**（与资料服务同一运行时；无第三方依赖）。

```powershell
node cli.mjs once   --config <私有配置>   # 单次轮询（诊断）
node cli.mjs run    --config <私有配置>   # 常驻轮询
node cli.mjs status --config <私有配置>   # 只读状态
```

配置（私有文件，字段与服务端登记一致）：

```json
{
  "schema_version": "1.0",
  "base_url": "https://cznbnb.cn/io-api/v1/",
  "owner_id": "turboio-user",
  "producer_id": "pc-desktop",
  "server_id": "<服务 /v1/identity 返回的稳定 UUID>",
  "computer_id": "<本电脑的稳定 ID>",
  "agent_id": "<本适配器对应的 Agent ID>",
  "credential_file": "pc-desktop.json",
  "state_file": "./private/bridge-state.json",
  "timeout_ms": 10000,
  "poll_interval_ms": 5000
}
```

- 传输规则与查询工具一致：仅 HTTPS（显式放行的回环 http 例外）、Bearer 只从私有文件读、不跟随重定向、响应 ≤1MiB、单次请求。
- 启动先核对 `/v1/identity` 的 owner/producer/server 与所需 scope（`tasks:read`、`tasks:update`、`requests:write`、`messages:receive`、`messages:write`、`receipts:agent`）；不一致或缺失立即停止，不发任何队列写操作。
- 执行适配器必须配置 `computer_id` / `agent_id`，仅接收匹配路由。`project_id` / `session_id` 原样传递，由适配器核验；managed Hermes 已核对显式登记的隔离 home、项目和会话。生产登记及其他适配器仍须分别验证。
- 凭据和账本相对路径均相对于配置文件目录。`status` 只读本地账本，不联网、不验证令牌、不启动适配器、不创建或更新账本；输出 `network_checked=false`，不能据此判断在线。

## 运行时适配器接口

默认（`cli.mjs`）是**只观察**适配器：`can_execute=false`，不调用运行时工作方法，不写任务状态与回执，也不消费 inbox 游标。真实适配器（P42）实现：

```js
{
  name: 'hermes',                       // 仅用于状态显示
  capabilities: { can_execute: true },  // 是否真的能执行；决定程序是否敢于确认任务
  onItem(item) -> [action],             // task/message；item 含 kind/object_id/revision/body/state/commit_seq/event_id
  onAnswer({request, answer}) -> [action],
  onRequestClosed({request}) -> [action]  // 可选：问题被撤回/过期
}
```

可用动作：

| action | 必填 | 效果 |
| --- | --- | --- |
| `{action:'none'}` | — | 什么都不做（默认） |
| `{action:'task_state', state}` | `state` 必须是可发布任务状态 | 发布 `revision+1` 的同 route 任务版本；**若当前状态已相同则不发布**（避免无意义的冲突） |
| `{action:'receipt', stage, subject_kind, subject_id, subject_revision}` | stage 限 `agent_received/task_resumed/task_completed/cancel_requested/cancelled/failed` | 追加一条回执事实（客户端不能写 `server_stored`/`expired`） |
| `{action:'request', mode, question, options}` | choice 需 ≥2 个唯一选项 | 以确定 ID 创建 `revision=1` 的提问，并跟踪等待答复 |

已检查的非法动作（未知类型、不可报告阶段、无效选项）以 `BRIDGE_ACTION_INVALID` 停止；整组动作先校验，再原子保存 outgoing events，后续动作失败不会留下半截 outbox。运行时交付证据会保留。动作尚未全面接入 JSON Schema 校验，不能宣称所有越界字段都已拒绝。

## 适配器进程（推荐用法）

`adapter_command` 指向一个独立进程（不经 shell），桥接进程用**一行一个 JSON** 的请求/响应与它通信：

| 方向 | 帧 |
| --- | --- |
| → | `{"id":1,"type":"hello","protocol":1}` |
| ← | `{"id":1,"ok":true,"capabilities":{"can_execute":true,...}}` |
| → | `{"id":2,"type":"item","item":{...}}` |
| ← | `{"id":2,"ok":true,"actions":[...]}` |
| → | `{"id":3,"type":"answer","request":{...},"answer":{...}}` |
| ← | `{"id":3,"ok":true,"actions":[...]}` |
| → | `{"id":4,"type":"closed","request":{...}}` |

- 能力先声明：`can_execute=false` 的适配器不会产生任何写入。
- 静默超时、进程崩溃、输出非 JSON 一律按失败处理（`ADAPTER_TIMEOUT`／`ADAPTER_EXITED`／`ADAPTER_PROTOCOL`），**绝不当作成功**；超时会杀掉该进程。
- 协议错误、未知回复 ID、缺失动作数组或明确拒绝会立即撤销执行能力并终止子进程；本进程后续回复不能恢复执行。必须完成 `stop()` 后重新启动并重新握手。协议 v1 仅接受匹配请求的回复；异步事件采用下述显式 poll/ack 扩展，不接受无匹配请求的 stdout 推送行。
- 配置示例：`"adapter_command": ["python", "adapters/hermes-adapter.py"], "adapter_timeout_ms": 15000`。

**P11 的历史接口结论仍适用**：`<HERMES_HOME>/gateway.sock`（Windows 为命名管道）只提供管理动词（identify/status/rescan/serve-profile 等）；会话动词 `session.create`／`session.resume`／`session.activate`／`prompt.submit` 由 `tui_gateway` 的 JSON-RPC 分发器在 Hermes 进程内提供。实测（见[补测](../../docs/product/phase1-hermes-restart-2026-10-11.md)）过期 live id 被拒绝、stored session 可恢复但产生新 live id、**auto-continue 会重新投递 prompt 形成新问题**、旧 runtime_request_id 不会恢复。当前接线采用已验证的 managed ACP 运行时与固定 CLI 工具，不用 auto-continue 冒充 `task_resumed`，不在恢复失败后新建替代会话。

[官方 ACP SDK 传输组件及 managed 适配器](./hermes/README.md)已通过真实 stdio、固定 CLI 原任务问答和真实模型取消验证。安装版 ACP 的 `end_turn` 不等于任务完成：异常或忙时入队也会返回该值，不能据此生成完成回执。生产接线和崩溃后原等待栈恢复尚未验收。

## 状态与可靠性

### 延迟提问和完成事件

适配器声明 `capabilities.async_events=true` 后，必须实现 `pollEvents()` / `acknowledgeEvents(ids)`。原同步接口继续兼容；桥接向 `item` / `answer` / `closed` 帧附加稳定的 `delivery_id`，在调用前将该 ID 与不可变来源保存到本地账本。进程协议扩展：

```json
{"id":8,"type":"events","limit":20}
{"id":8,"ok":true,"events":[{"event_id":"runtime-question-1","delivery_id":"item:task:task-1:1","actions":[{"action":"request","request_id":"request-1","runtime_request_id":"wait-1","mode":"free_text","question":"合成问题"}]}]}
{"id":9,"type":"events_ack","event_ids":["runtime-question-1"]}
{"id":9,"ok":true}
```

- `onItem` 及时返回接收事实，不能等待用户回答；后续问题由 `events` 读取。真实适配器须先持久保存事件并重复返回，收到 ACK 后才能移出待读集合；本仓库参考适配器仅为内存测试子进程，不具有运行时持久保证。
- 事件 ID 全局稳定，相同内容可重放；相同 ID 改变来源/动作报 `RUNTIME_EVENT_CONFLICT`。一批最多 20 项，拒绝批内重复 ID。必须引用已保存的投递来源，不能由事件自行选择任意 project/session。
- 来源目前限已投递的 task/request，receipt 限该原任务；未知来源拒绝。实际原任务已完成/取消/失败/过期时停止并保留迟到事件；取消请求后拒绝新问题。该停止保护尚不是自动撤回与运行时取消确认。
- 事件去重事实与它生成的 outbox 在同一次原子账本保存中写入，然后 ACK。**ACK 仅表示电脑连接程序已持久接管**，不表示服务器落库、眼镜显示、用户回答或任务完成。丢 ACK 后重复事件只确认，不重新产生动作。
- `runtime_sources` / `runtime_events` 各最多 20,000 条，到上限停止，不自动删去去重证据；长期归档及事件期限裁决待实现。协议只提供承载能力，真实 Hermes 路由、异步工具等待点、运行时事件持久性和 owner 重启仍未验收。
- request 动作可选 `expires_at`：UTC ISO 字符串，首次接管须尚未过期且不超过未来一小时；保留为请求信封期限，重试不延长。省略时保持原一小时策略。格式错误、已过期或超限整体拒绝动作并保留运行时事件；这不是自动过期/撤回裁决。

managed Hermes 另声明 `admission_probe_v1=true` 时，支持只读 `admission_probe` 帧（`delivery_id`、原 `source`），返回 `admission`。仅用于已有 prepared 的原版本1 queued任务，核对运行时原命令、原来源与事务内 admitted 事件。查证成功只补回确定的空 intake 响应，状态/结果仍取原运行时事件；不重发 onItem，不恢复答案或取消投递。无事实时保留 DISPATCH_UNCERTAIN，不将缺记录解释成允许重试。

`answer_intake_probe_v1=true` 另提供只读 `answer_intake_probe` 帧（delivery_id、原 request、派发前保存的 answer 快照），返回 answer_intake。严格核对运行时保留的原问题和相同答案，即使原等待已消费也不重发 onAnswer。成功仅补回答案 agent_received，task_resumed/完成必须取原事件。旧 prepared 缺答案快照或无证据时停止；状态 unknown 的任务不因已接收而重新执行。审计与回应原子保存，status 的 reconciled_answers 不表示任务完成。

`start()` 先获取运行所有权、完成身份/scope 与账本检查，再启动适配器并保存状态；嵌入调用必须在 `finally` 中 `await bridge.stop()`。CLI 已接好此顺序。`pollOnce()` / `flush()` / `start()` 不可并发调用（`BRIDGE_BUSY`）；停机时拒绝新工作（`BRIDGE_STOPPING`），等待当前交付及适配器退出后才释放所有权。适配器进程的 kill 请求不算退出确认；未收到退出确认报 `ADAPTER_STOP_FAILED`，不当作停机成功。

运行锁使用 Node 22 内置 SQLite 的 rollback-journal `BEGIN EXCLUSIVE`，不安装依赖：账本旁 `<state_file>.run-lock.sqlite` 阻止同账本双开；OS 账户 home 下 `.turboio/bridge-runtime-locks-v1/<hash>.sqlite` 阻止相同 server/owner/computer/agent 换账本或 producer 绕过。路径规范化，拒绝硬链接账本；竞争者以 `BRIDGE_IN_USE` 停止，不启动适配器、不改账本。系统在进程硬退出后释放文件锁，持久化 prepared 仍需对账。**不要删除锁侧库来解锁**。当前实测范围是 Windows、本地文件系统、同一 OS 账户；跨用户、网络文件系统和多电脑租约未验证。

`state_file` 是唯一事实来源，原子写入（临时文件 + fsync + rename）：

| 字段 | 含义 |
| --- | --- |
| `binding` | schema 2 账本绑定 server/owner/producer/computer/agent；不同绑定拒绝启动 |
| `dispatches` | 调用运行时前持久化 prepared，答案同时保存原快照；收到动作后持久化 responded。首次任务或答案有对应严格接收证明时限定恢复，其他 prepared 保留 `DISPATCH_UNCERTAIN`，不自动重投 |
| `intake_reconciliations` | 已核对首次任务接收的审计摘要；不保存正文，不表示任务完成。schema 2 可选字段，有容量上限 |
| `answer_intake_reconciliations` | 严格核对原问题和答案的接收审计；不表示原任务继续或完成，不重新消费答案 |
| `cursor` | inbox 游标；**只在整页处理完后推进**，崩溃/离线不会跳过队列 |
| `outbox` | 已持久化的待发事件（含完整信封）。重试**复用同一份字节**，因此服务端幂等去重成立 |
| `handled` | 已处理的 inbox 修订（`kind:object:revision`），重启后不重复处理 |
| `answers` | 已交付给适配器的答复（`request:revision:answer`）；已测试重启去重，本地多进程所有权边界见上文；不是运行时 exactly-once 保证 |
| `requests` | 仍在等待答复的提问（PRD 的 `glasses.get_reply`），每轮复查 `pending/presented/answered/withdrawn/expired` |

可靠性语义：

- **至少一次 + 去重**：网络中断后重试同一信封；服务端按 `(owner,producer,idempotency_key)` 返回原回执。
- **丢回复对账**：POST 结果不明时用 `GET /v1/events/{event_id}` 查证，必须匹配 event/object/revision 与 `server_stored` 回执，不能只凭 HTTP 200 清除 outbox。
- **运行时结果不明**：调用前落 prepared，崩溃后停止自动投递。首次任务/答案的接收证明只修复对应交接；实际执行 unknown 仍需明确结果对账。这不是恢复原工具栈或 exactly-once 保证。
- **提问上传延迟**：服务器尚查不到、但 outbox 仍有请求时，保留等待记录；已确认落库的问题突然消失则停止并保留账本。
- **永久拒绝即停**：401/403/400/404/409/410 等不可重试错误会置 `blocked`（含 key 与 code）并停止轮询，信封保留给运维处理，不静默丢弃。
- **状态文件损坏即停**（`STATE_CORRUPT`）：不重置游标、不重放队列；`server_id` 变化时 `STATE_SERVER_MISMATCH`。非空 schema 1 旧账本没有完整身份绑定，拒绝自动接管（`STATE_IDENTITY_MISMATCH`）；保留原文件，需核验身份和运行时事实后单独迁移，不能删除重建来绕过。
- 错误输出只有错误码与受限细节：URL、令牌、用户正文不进入日志。

## 验证

```powershell
node --test tests/*.test.mjs
node verify.mjs                                                 # 记录 verification/result.json 与 tests.tap
```

Windows 的真实拒绝替换句柄测试需要 Python；自动查找 python/py/python3，也可设置 `TURBOIO_TEST_PYTHON` 为现有解释器路径。自动查不到会明确跳过该用例并记入未验证；显式指定的解释器不可用则失败，不伪造通过。其余文件替换/所有权回归不依赖 Python。

2026-10-13 正式入口 82 项通过：连接程序 58、适配器进程 13、CLI 3、运行锁 5、Windows 原子替换 3。连接程序用真实临时 SQLite、HTTP 和合成对象；适配器用测试替身/测试子进程；CLI 状态测试完全离线。新增答案接收证明、缺证据停止与真实 Windows 文件占用回归。证据 [result.json](./verification/result.json)，其中的未验证范围仅指本入口；真实 Hermes 和公网专项另见[答案接收核对记录](../../docs/product/phase4-answer-intake-reconciliation-2026-10-13.md)。57 项为此前历史快照，不能当作当前计数。测试数量不代表产品验收。

## 当前边界

真实 Hermes 固定 CLI 经公网 HTTPS 的原任务问答、排队、取消、正常重启及答案接收回复丢失后的只读恢复已通过隔离专项；手机角色由电脑驱动代发。原始答案只执行投递一次，接收证明不产生 task_resumed 或完成。实际 ACP 过期等待、明确对账和首次任务接收查证的对应专项使用合成模型。**生产身份登记、正式路由及手机/眼镜端到端尚未验收**。取消/问题关闭交接、其他版本或缺原答案快照的 `DISPATCH_UNCERTAIN`、硬崩溃后的原等待栈、跨 OS 用户/多电脑所有权、完整动作 Schema、原音、同身份凭据续期及长时稳定性仍未完成。默认只观察；实验凭据已撤销，没有启用正式任务连接。
