# P30 独立资料服务

实现文字和元数据的真实 SQLite 收存、修订 CAS、去重、查询及增量游标。独立进程/数据库，不依赖现有网站 Cookie、业务表或电脑 Agent。**已于 2026-10-11 部署到 `https://cznbnb.cn/io-api/v1/`**（独立 systemd 服务＋独立 Node22＋独立数据目录，站点业务未改；见[部署记录](../../docs/product/phase1-server-reuse-2026-10-11.md)与[部署包](./deploy/README.md)）。后续手机合成同步与电脑连接程序的受控云端验证已有独立记录，见本文验证范围；原音上传与完整产品验收仍未完成。

首次部署后的服务器本机 HTTPS 实测（合成数据）：未认证 401、身份绑定、写入 201 且回执 `server_stored`、同事件重发 200 且值一致、原文精确读回＋来源引用、增量游标可见——证据 [server-live-verification.json](../../rebuild/phase1/server-live-verification.json)、[server-deployment-facts.json](../../rebuild/phase1/server-deployment-facts.json)。该历史记录自身不证明公网或手机同步；后续公网/手机单项分别列在下文。凭据 24 小时上限、无自动轮换；`probe-*`／`live-check-*` 为自检合成行。

2026-10-12 只读管理后台、独立 API 流量账本与原命令期限元数据已随 `io-server-20261012-r1` 发布，见[实际发布与验证边界](../../docs/product/phase4-server-release-package-2026-10-12.md)。公网443已放行，HTTPS 页面和静态资源检查通过；[后台入口](https://cznbnb.cn/io-api/v1/admin)的统计仍需 operations:read 专用凭据。后续公网合成 owner 的认证统计 API 已验证，见[云端队列后验](../phase1/cloud-queue-verification-2026-10-13.json)；真实用户带权限后台 UI 仍待验收。

2026-10-14 当前 r3 已生产激活：源码绑定 `a1cbf1900cc0513a98b9f106f2b6462598bd8f5b`，支持资料1.2的字典、更正、拆句来源及原音missing元数据。真实公网 HTTPS 与实际查询 CLI 合成后验17/17通过，见[发布记录](../../docs/product/phase2-speaker-server-release-preparation-2026-10-13.md)与[合成后验](../phase1/cloud-speaker-r3-20261014-0104-speaker-verification.json)。这些是独占合成owner的服务器/电脑证据，手机实际1.2同步与真实日常资料查询仍未验收。

## 运行

固定验证环境 Node **22.23.2**，版本文件 `.node-version`；依赖通过 `package-lock.json` 锁定。Node20 的现有网站进程不能直接运行此服务，不得替换网站运行时。`node:sqlite` 在此版本仍为实验 API，调用同步阻塞事件循环；当前面向单用户的小服务，容量、磁盘满、真实服务器负载尚需验证。依据 [Node22.23.2 SQLite 文档](https://raw.githubusercontent.com/nodejs/node/v22.23.2/doc/api/sqlite.md)。

在本目录运行 `npm ci --ignore-scripts --no-audit --no-fund` 和 `npm test`。仅本机开发可显式设置 `TURBOIO_CONTRACT_DEV_DEPS=1` 使用项目 DevEco 工具依赖；部署必须使用服务自己的锁定依赖，不启用该回退。

Windows 本机示例（仓库根目录；私人文件目录必须受本机账户 ACL 保护）：

```powershell
$serviceRoot = (Resolve-Path 'rebuild/material-server').Path
$privateRoot = Join-Path $serviceRoot 'private'
New-Item -ItemType Directory -Path $privateRoot -Force | Out-Null
$databasePath = Join-Path $privateRoot 'materials.sqlite'
node "$serviceRoot/cli.mjs" mint --db $databasePath --owner user-local --producer phone-local --scopes materials:write,materials:read,changes:read --out "$privateRoot/phone.json"
node "$serviceRoot/cli.mjs" serve --db $databasePath --port 3401
```

只监听 `127.0.0.1`。本机 HTTP 用于隔离测试；公开地址必须经验证的 HTTPS 反代。生产 nginx 已将 `/io-api/v1/` 映射到逻辑 `/v1/`，公网HTTPS已有上列合成后验证据；实际使用仍须核对当前身份和响应。`/health` 仅返回服务名/数据库版本，不提供用户数据。服务默认不开放 CORS，不提供远程注册/发令牌入口，不将请求内容、URL、SQL、令牌或堆栈写日志。

管理员 `mint` 生成随机32字节 Bearer，只把原值写入指定的新文件，标准输出仅 token_id/到期时间。DB 保存 SHA256 摘要；有效期默认1小时、最多24小时，允许分别签发只读查询主体。owner/producer 限非用户内容的1–128字符标识；凭据刷新保留这两个主体 ID。`revoke --db <绝对路径> --token-id <ID>` 即时撤销。不提供自动刷新或用户登录，手机集成前需要登记/轮换通道。POSIX 新目录0700/令牌文件0600；Windows需另核对 ACL。

## 已实现接口

| 接口 | scope | 结果 |
| --- | --- | --- |
| GET `/v1/identity` | 任意本服务已授scope | 真实owner_id、producer_id、稳定server_id、scopes及凭据期限；上传前核对绑定 |
| POST `/v1/material-events` | materials:write | 1.0/1.1/1.2 `material.revision`；首次201，重复200 |
| GET `/v1/events/{event_id}` | 任意本服务已授scope | 只查同owner、同producer已接受事件的原回执；用于丢回复对账 |
| GET `/v1/materials/{id}?revision=N` | materials:read | 最新或指定不可变修订；墓碑后包括历史读取均410 |
| GET `/v1/materials?from=&to=&keyword=&speaker=&limit=&cursor=` | materials:read | 截止固定提交序号的资料快照 |
| GET `/v1/changes?limit=&cursor=` | changes:read | 修订/墓碑增量；终页游标可继续轮询 |
| POST `/v1/tasks` | tasks:write（首版）／tasks:update（后续版本） | 手机发起的命令任务；route 绑定与状态机 CAS |
| POST `/v1/requests` | requests:write | 电脑发起的提问版本；必须绑定同 route 的已有 task |
| POST `/v1/requests/{id}/reconcile` | requests:write | 同版本按服务器时钟/父任务关闭问题并写独立请求回执；可协商能力，r2已上线并通过公网合成验证 |
| POST `/v1/answers` | answers:write | 原子接受首个有效答案并置 request 为 answered；冲突409 `ANSWER_ALREADY_ACCEPTED` |
| POST `/v1/messages` | messages:write | 命令/问题/进度/结果/取消通知的不可变版本 |
| POST `/v1/receipts` | receipts:phone／receipts:agent／receipts:storage | 按阶段分别记录事实；不允许客户端声明 server_stored |
| GET `/v1/tasks/{id}`、`/v1/requests/{id}`、`/v1/messages/{id}` | tasks:read\|tasks:update、requests:read\|requests:write、messages:receive\|messages:write | 当前 state、最新修订及该对象/答案的回执阶梯 |
| GET `/v1/inbox?limit=&cursor=` | 任一可读队列scope | 按提交序号投递 task/request/message；游标绑定可见类型 |
| GET `/v1/operations/summary?hours=24` | operations:read | 同 owner 的状态/回执计数、最近修订与已认证 API 正文字节统计；已部署且公网合成认证API已验证，真实用户后台UI仍待验收 |
| GET `/v1/admin` | 仅页面外壳公开 | 只读管理页已部署；业务统计仍需独立凭据 |

Authorization 为 `Bearer <token>`，不接受查询参数凭据。由凭据推导 owner，producer必须与信封一致。未认证401，缺scope/冒充producer403，外owner的ID查不到。1.0事件原样保留其版本，不编造全文/转写覆盖；1.1原样保留 full_text/processing；1.2另保留资料内speakers字典及已校验的source_range。未知版本拒绝。

手机发送前先核对identity与已登记的owner/producer/server三者完全一致，并且具备materials:write；不能只相信配置里为令牌写下的标签。server_id为数据库内持久随机UUID，服务重启/备份保留，新建空库产生新ID。迁移到另一服务需要显式登记并重新对账，不能继承原服务的已存回执。

直接事件请求 UTF-8≤256KiB；超限413。2026-10-24 新增可协商的[长资料传输](../../docs/contracts/material-transfer-v1.md)：保持单请求上限，分块组装至 8 MiB，仍提交同一完整资料修订，不截断、不伪造拆分；目前仅源码与合成验证，未发布。JSON重复键（包括转义后相同名称）、非法UTF-8/孤立代理项、超过64层嵌套均拒绝。按 [RFC8785](https://www.rfc-editor.org/rfc/rfc8785.html) 的ECMAScript序列化和UTF-16键排序计算SHA256；不会通过先排序到普通Object再stringify导致数字键被重排。

成功响应例（结构示意，ID均由实际提交产生）：

```json
{"schema_version":"1.1","event_id":"evt-demo","material_id":"mat-demo","revision":1,"commit_seq":1,"stored_at":"2026-10-11T02:00:00.000Z","duplicate_of":null,"receipt":{"receipt_id":"receipt-demo","subject_kind":"material","subject_id":"mat-demo","subject_revision":1,"stage":"server_stored","actor_id":"server-storage","related_event_id":"evt-demo","error":null}}
```

`server_stored` 仅证明本次资料事务提交，不表示手机收信、眼镜显示、人已回答、Agent接收或任务完成。`audio.local` 仍未备份；本服务没有原音finalize账本，所以任何客户端 `stored_verified` 或非null object_id声明均409 AUDIO_NOT_VERIFIED。

## 事务与重放

SQLite WAL、synchronous FULL、BEGIN IMMEDIATE；资料头、不可变修订、owner私有提交序号、事件幂等账本及可补拉变更同事务提交后才201。写入失败回滚全部；启动拒绝未知数据库版本或混用已有无版本业务库。没有自动清理墓碑、旧修订、事件记录；因此当前去重保留超过契约最低期限，不把用户资料按天清除。

去重键 `(owner,producer,idempotency_key)`；同键同canonical事件返回完全相同的响应和receipt_id（HTTP200），同键不同载荷409。**注意**：重放响应取自幂等账本里按 RFC8785 规范化保存的副本，因此字段值与原回执完全一致、`receipt_id` 相同，但键序是字典序；客户端必须按结构比较，不能按字节比较（`live-verify` 曾因此误判，已改为结构化比较）。event_id在owner内唯一，不允许跨producer借用它读取回执。期限以服务器时间裁决；过期重试也410，随后可GET事件状态。重新签发不同event_id/幂等键但完全相同material_id/revision/body/schema_version时200，保存新信封回执并标记duplicate_of原事件，保持原commit_seq/stored_at，不新增资料修订、不把最新头倒退。与已存修订内容不一致则409。

revision必须base_revision+1、base等于当前头。正文/逐句内容变化需要text_revision+1；纯元数据修订允许文字版本保持，删除清空可保持最后文字版本（与现有手机一致）。删除后禁止新upsert复活；旧相同载荷可语义确认已存历史，但不能读取被删正文。旧内容没有物理销毁，保留在服务端历史中，仅本地管理员可操作。原音归档删除尚未实现。

## 查询、删除和游标

时间from/to使用带时区RFC3339，按资料区间重叠筛选。keyword是全文和逐句文字的大小写折叠子串，包含无时间轴的历史Markdown，不是向量/语义检索。speaker精确匹配utterance.speaker_id，只证明当前标签，不推断实名。

分页结果为 `{items:[{schema_version,body,commit_seq,stored_at}],has_more,next_cursor,server_time,fresh_until}`；默认20条、最多50条，总响应约≤1MiB。每owner独立seq。游标HMAC签名，绑定owner、查询类型、过滤条件和24小时有效期；不同limit可以续查，改过滤条件必须重新查询。游标篡改、跨owner、过期、恢复旧备份后指向未来序号都410 CURSOR_RESET_REQUIRED，不能偷偷跳到最新。

资料分页保持首次查询的ceiling，后续更新不会使分页遗漏/重复原快照中的资料；**删除优先于快照**，当前已删除资料的旧版本不再从列表返回。changes也不重新发布已删除对象的旧正文，只返回其墓碑；因此seq允许跳跃，消费方不能把每条观察强制当作待写入的连续CAS事件。终页将last推进到ceiling，changes释放ceiling，下次从该位置补拉新提交。保留期内没有增量裁剪。

fresh_until等于server_time，只说明查询当时，未承诺未来无更新。错误使用P14统一结构；409返回可用的current_revision，503带可重试提示；不在500响应暴露堆栈。

## 消息、请求与答案队列（P40）

2026-10-12 质量复审补丁：初始任务必须为 `queued`；父任务处于取消中、终结或执行结果不明时，新增答案拒绝为 `409 TASK_CLOSED`；读取对象的 `receipts` 严格匹配 subject_kind / subject_id，保留历史事实中的 subject_revision，不把旧版本回执当成当前版本确认。该三项 store-only 修复当时已获授权并部署，详见[历史发布记录](../../docs/product/server-store-release-2026-10-12.md)；该批历史证据不包含后来增加的后台和期限字段。后续r1已上线后台及期限元数据，r2已上线问题收尾，分别见[r1发布](../../docs/product/phase4-server-release-package-2026-10-12.md)与[r2发布](../../docs/product/phase4-lifecycle-release-2026-10-12.md)，当前r3保留这些能力。

任务读取/inbox 队列项包含该修订的 `expires_at`；任务另含固定取 revision 1 的 `command_expires_at`，后续状态事件的新传输期限不能延长原命令。连接程序持久保存两个字段；完整运行时的自动期限裁决仍未验收。事件 schema 和主库版本不变。

队列对象沿用 P14 `event-v1.schema.json` 的五个 kind（`task`/`request`/`answer`/`message`/`receipt`），以 `schema_version=1.0` 信封提交，落库方式与资料一致：同一事务内校验、CAS、保存不可变修订与幂等记录后返回；同键同内容200且返回原回执，同键改内容409，`event_id` 在 owner 内唯一。数据库 `user_version=2`：v1 文件打开时自动补建队列表，资料、凭据、幂等账本和游标密钥不动。

- **身份与 scope**：手机 `materials:write/read`、`tasks:write`、`tasks:read`、`requests:read`、`answers:write`、`messages:receive`、`receipts:phone`；电脑连接程序 `messages:receive`、`messages:write`、`tasks:read`、`tasks:update`、`requests:write`、`receipts:agent`；服务器内部 `receipts:storage`。只有手机创建命令任务（`tasks:write`），只有电脑程序推进任务状态（`tasks:update`）；能写某类对象即可读回它，便于对账。回执阶段绑定身份：`phone_received`/`glasses_displayed`/`user_answered` 需 `receipts:phone`，Agent/任务阶段需 `receipts:agent`，`server_stored`/`expired` 只能由 `receipts:storage` 写入，客户端不能自称已存。
- **状态机**：任务 `queued → agent_received → running ↔ waiting_answer → completed/failed`，另有 `cancel_requested → cancelled`、`expired`、`execution_unknown`；终结状态不可再改。请求 `pending ↔ presented → answered`／`withdrawn`／`expired`。`answered` 不能由客户端发布，只能由答案事务产生。非法状态跳转409 `STATE_CONFLICT`，修订不连续409 `REVISION_CONFLICT`，route 在对象生命周期内不可变（409 `ROUTE_MISMATCH`）。
- **答案**：必须携带 `request_id`、`request_revision`、`task_id` 与相同 route。`BEGIN IMMEDIATE` 内原子 CAS：首个有效答案被保存并把请求置为 `answered`，第二终端409 `ANSWER_ALREADY_ACCEPTED`；旧版本409 `STALE_REQUEST`，撤回/过期410 `REQUEST_CLOSED`／`EXPIRED`，未知选项400 `INVALID_OPTIONS`，既无选项又无文字400 `INVALID`。结构化 `option_id` 不会抹掉 `text` 中的附加条件，`input_source`/`raw_action` 原样保留。
- **回执**：只追加、按 `receipt_id` 去重，须指向真实存在的对象修订（否则404 `SUBJECT_NOT_FOUND`）；同ID不同内容409。回执不修改任何对象状态，迟到回执不会把状态倒退。任务/请求/消息读取各自只列属于自己 subject 的回执，答案的阶梯（`user_answered` → `agent_received` → …）挂在答案上。
- **投递**：`GET /v1/inbox` 按 owner 私有提交序号返回 task/request/message，游标 HMAC 签名、绑定可见对象类型与限额，终页游标可继续轮询；可见类型变化（换scope）会让旧游标410 `CURSOR_RESET_REQUIRED`，不能静默跳过缺口。`GET /v1/events/{event_id}` 现在任何已认证主体都可以取回**自己 producer** 的事件回执，用于丢回复对账。
- **绑定**：请求和消息都必须指向同 route 的已有 task（否则404 `TASK_NOT_FOUND`／409 `ROUTE_MISMATCH`）；消息的 `request_id` 非空时该请求也必须存在且 task/route 一致；答案的 `task_id` 必须与请求绑定的 task 相同。队列对象只接受 `schema_version=1.0`，1.1/1.2只扩展资料。

此服务端模块负责持久化与状态裁决，手机/电脑收发与运行时由独立模块实现。后续手机合成资料联网及电脑真实Hermes云端受控联调已有下列独立证据；MQTT/WS后台唤醒、手机/眼镜任务完整闭环与产品验收不能据此关闭。

## 备份与恢复边界

`backup --db <绝对路径> --out <新的绝对备份路径>` 使用SQLite在线备份API、quick_check及文件fsync，再独占发布；已存在备份/源数据库不会被覆盖。Linux另外fsync目录。不能只复制运行中的`.sqlite`而漏掉WAL。备份包含摘要凭据、历史资料和游标密钥，需同等级权限及加密/异机策略；本批只验证本机恢复，没有配置腾讯云定时备份或灾难恢复。

恢复前先停本服务，留存当前完整数据库与WAL，核验备份，再由管理员切换数据库路径，禁止覆盖正在服务的文件。恢复旧备份会丢失其后的提交和撤销记录：必须撤销恢复库中的全部凭据并重新登记，要求客户端重新对账及重建游标。不要把旧备份恢复宣称无损回到断点；本机崩溃恢复与灾备回滚是不同场景。

## 只读查询工具（P33）

`query/cli.mjs` 是电脑端 Agent 的调用入口，`query/client.mjs` 是可复用的同一实现，只发 GET：按时间/关键词/说话人检索、取不可变原文修订、用签名游标拉增量，并为每条结果与匹配附 `source_ref` 来源引用。它不写资料、不上传原音、不建任务、不启动 Agent；Bearer 只从配置文件指向的私有凭据文件读取，不接受命令行或环境变量传入，不跟随重定向，响应上限 1MiB；每次调用先核对身份再发查询请求（两次 GET），不自动重试。调用方式、输出约定与错误处理见[查询工具说明](./query/README.md)，Agent 版说明见 [skill/turboio-material-query](./skill/turboio-material-query/SKILL.md)（本批仅维护仓库说明，未安装或启用skill；真实会话调用仍待验收）。工具只反映服务端已存内容：`freshness.scope` 为 `server_stored_only`，`phone_sync_status` 为 `unknown`，原音播放不可用；转写覆盖不完整时不得把“没查到”当成“用户没说过”。

## 验证范围

测试使用实际临时SQLite、真实子进程硬退出与loopback HTTP；没有mock数据库。包含COMMIT前退出回滚、COMMIT后丢回复对账、并发去重、备份重开、重启游标、跨owner、撤销/过期、大文本分页和删除抑制。队列另有独立套件：P14 正常/重复/过期样例形状、真实 HTTP 决策闭环、两个独立进程争抢同一答案、状态机与 route 绑定、scope 分离、回执阶梯与去重、游标分页与可见性变更、v1→v2 迁移、复审三项反例与原任务期限保留。保存的0.1.39真机**合成**导出r1–r5也未经改字段按序验证。它证明载荷兼容，不是手机联网同步或真实日常对话的端到端验收。当前正式本机回归69/69：资料18＋队列14＋后台7＋问题收尾8＋查询11＋说话人11，查询11已包含在69中，不另累计。证据：[result.json](./verification/result.json)、[tests.tap](./verification/tests.tap)、[queue-tests.tap](./verification/queue-tests.tap)、[operations-tests.tap](./verification/operations-tests.tap)、[request-lifecycle-tests.tap](./verification/request-lifecycle-tests.tap)、[query-tests.tap](./verification/query-tests.tap)、[speaker-tests.tap](./verification/speaker-tests.tap)。

腾讯云部署和服务器本机 HTTPS 已核实，2026-10-12 已按用户授权放通 TCP 443。手机较早1.1合成资料的真实 HTTPS 上传、修订/删除及断网后冷启动补传证据见[手机离线恢复](../../docs/product/phase3-phone-offline-recovery-2026-10-12.md)。`request_lifecycle_v1` 已随r2部署并完成公网合成问题收尾验证，见[发布记录](../../docs/product/phase4-lifecycle-release-2026-10-12.md)；电脑真实Hermes云端问答/继续/取消的受控验证见[云端联调](../../docs/product/phase4-cloud-hermes-2026-10-13.md)，其中手机角色由电脑合成driver代发。当前r3资料1.2的公网服务器与实际CLI查询后验见上文，手机1.2更正同步及真实用户日常资料查询仍待验证。生产身份和手机/眼镜任务完整云端闭环、完整恢复、原音、长期容量/磁盘故障、限流及凭据轮换仍未验收；完整 P30/P40 及 AC-QUERY、AC-ASK 不据上述单项关闭。
