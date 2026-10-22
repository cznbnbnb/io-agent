# P40 可靠消息队列：服务端持久化与状态裁决（本机验证记录）

日期：2026-10-11。承接[资料服务](./phase3-material-service-2026-10-11.md)与[查询工具](./phase3-material-query-2026-10-11.md)，按[开发顺序](./DEVELOPMENT-PLAN.md)第 7 节 P40 执行：实现命令、问题、答案、结果的持久化与状态，设备/Agent 分别鉴权。此文件记录结果，不替代 DEVELOPMENT-PLAN 顺序或 PRD 正式验收。

本批只改桌面服务端代码、契约补充说明与验证记录；未修改鸿蒙 App 源码、未安装手机候选包（手机仍为 0.1.45）、未部署腾讯云、未发起真实消息或任务、未读取用户资料。所有素材为 `docs/contracts/normal.json` 合成样例。

## 1. 实现范围

五个 P14 kind（`task`／`request`／`answer`／`message`／`receipt`）以 `schema_version=1.0` 信封提交，落库与资料一致：同一事务内校验、CAS、保存不可变修订、幂等账本后返回；同键同内容200且返回原回执，同键改内容409，`event_id` 在 owner 内唯一。

| 接口 | 作用 |
| --- | --- |
| `POST /v1/tasks` | 手机发起命令任务；route 在对象生命周期内不可变 |
| `POST /v1/requests` | 电脑提问版本；必须绑定同 route 的已存在 task |
| `POST /v1/answers` | 原子接受首个有效答案，并置 request 为 `answered` |
| `POST /v1/messages` | `command`/`question`/`answer`/`progress`/`result`/`cancel` 通知版本 |
| `POST /v1/receipts` | 按阶段记录事实，只追加、按 `receipt_id` 去重 |
| `GET /v1/tasks/{id}`、`/v1/requests/{id}`、`/v1/messages/{id}` | 当前 state、最新修订、属于该对象的回执（答案回执挂在答案上） |
| `GET /v1/inbox?limit=&cursor=` | 按 owner 私有提交序号投递 task/request/message |

关键裁决（全部有测试）：

- **状态机**：任务 `queued → agent_received → running ↔ waiting_answer → completed/failed`，另有 `cancel_requested → cancelled`、`expired`、`execution_unknown`；终结状态不可再改。请求 `pending ↔ presented → answered`／`withdrawn`／`expired`。非法跳转409 `STATE_CONFLICT`，修订不连续409 `REVISION_CONFLICT`，route 重绑409 `ROUTE_MISMATCH`。
- **答案原子性**：`BEGIN IMMEDIATE` 内检查请求版本与状态，首个答案写入并把请求置为 `answered`；第二终端409 `ANSWER_ALREADY_ACCEPTED`。两个独立进程同时作答只接受一个，落败方 409 且队列序号不前进。旧版本409 `STALE_REQUEST`，撤回/过期410 `REQUEST_CLOSED`／`EXPIRED`，未知选项400 `INVALID_OPTIONS`，既无选项又无文字400 `INVALID`。
- **不能自称的状态**：`answered` 只能由答案事务产生（客户端发布即409）；`server_stored`／`expired` 回执只能由 `receipts:storage` 写入，客户端提交即403；回执必须指向真实存在的对象修订，否则404 `SUBJECT_NOT_FOUND`。
- **答案不丢条件**：结构化 `option_id` 与 `text` 并存保留，`input_source`／`raw_action` 原样保存；测试断言附加条件（“方案 A，但只生成预览”）与选项同时可读。
- **身份分离**：手机 `tasks:write`、`tasks:read`、`requests:read`、`answers:write`、`messages:receive`、`receipts:phone`；电脑程序 `tasks:read`、`tasks:update`、`requests:write`、`messages:receive`、`messages:write`、`receipts:agent`；服务器内部 `receipts:storage`。手机不能推进任务状态，电脑程序不能创建任务或冒充用户回答。
- **投递游标**：inbox 游标 HMAC 签名并绑定可见对象类型，终页可继续轮询；可见类型变化（换scope）使旧游标410 `CURSOR_RESET_REQUIRED`，不静默跳过缺口。
- **库升级**：`user_version=2`，打开 v1 文件自动补建队列表；测试模拟旧文件（删除队列表并回退版本号）验证资料、凭据与游标密钥保留。

契约补充已写入[契约说明补充](../contracts/README.md)（scope 扩展、新增错误码、服务端裁决），kind 与 body 字段未变。

## 2. 验证结果

运行环境：Node **v22.23.2**，真实临时 SQLite、真实 loopback HTTP、真实子进程、无 mock。

| 套件 | 结果 | 覆盖 |
| --- | --- | --- |
| `tests/queue.test.mjs` | 10/10 | 真实 HTTP 决策闭环、双进程争抢答案、状态机/route/选项负例、scope 分离、回执阶梯去重、幂等与序号、游标分页与可见性、v1→v2 迁移 |
| `tests/service.test.mjs` | 18/18 | 资料事务、崩溃/丢回复对账、备份、撤销等既有回归 |
| `tests/query.test.mjs` | 11/11 | P33 查询工具回归 |

`npm test` 共 **39 项**通过；项目级 `rebuild/phase1/verify.ps1`（鸿蒙 App 套件＋契约一致性）通过，本批未改 App 源码。证据：[result.json](../../rebuild/material-server/verification/result.json)、[queue-tests.tap](../../rebuild/material-server/verification/queue-tests.tap)、[tests.tap](../../rebuild/material-server/verification/tests.tap)、[query-result.json](../../rebuild/material-server/verification/query-result.json)；复现命令 `cd rebuild/material-server && npm test`、`node verify.mjs`、`node query/verify.mjs`。

## 3. 仍未完成

- **发送端与接收端都未实现**：手机没有队列生产/消费代码；电脑连接程序的**服务端交互部分**已在 P41 完成（[连接程序记录](./phase4-agent-bridge-2026-10-11.md)），但真实运行时适配器与真实云端出站仍未接通，因此还没有任何真实消息在两个终端之间流动过。
- 没有 WS/推送唤醒、断线补拉和在线状态上报；inbox 只有轮询语义。
- 没有运行时适配器（P42）：`SESSION_NOT_FOUND`、`execution_unknown` 对账、qids 映射都只在契约里。
- 未部署腾讯云、未验证 HTTPS，手机传输组件仍是硬性 HTTPS 要求；本批全部验证都在本机回环。
- 因此 **P40 只完成服务端部分**，P41–P44、AC-ASK、AC-DUP、AC-OFF 均未达标；下一步按计划顺序做 P41 电脑常驻连接程序（可先在本机回环下实现与验证），部署与真机联测仍取决于服务器凭据与 TLS。

## 4. 部署前置（已另备材料）

服务器定位与边界见[腾讯云接入边界](./phase1-server-reuse-2026-10-11.md)。本批附带可评审的部署材料（nginx 位置片段、独立服务单元、只读盘点清单、回退步骤，见 `rebuild/material-server/deploy/`），**尚未在任何主机上执行**；真实部署需要用户确认共享主机授权、SSH 访问、TLS 证书与 Node22 并存方案。
