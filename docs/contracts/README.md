# P14 最小接口契约 v1.0 与资料扩展 v1.1

日期：2026-10-10。用于手机、资料服务器、电脑连接程序和运行时适配器后续共同实现。JSON Schema 和合成样例已可运行校验；本批没有部署服务器，不能据此宣称同步或端到端已接通。

2026-10-11用户指定共用现有腾讯云主机，候选外部前缀 `/io-api/v1/` 映射下文逻辑 `/v1/*`；当时仍未部署、事件Schema不变；后续资料1.1扩展见下文。现有网站Cookie不替代设备/电脑Bearer授权，HTTPS/WSS仍需验证，见[服务器复用说明](../product/phase1-server-reuse-2026-10-11.md)。真实Hermes owner重启已证实旧问题失效、自动续接会产生新问题；按下文execution_unknown和代次/版本对账，见[补测](../product/phase1-hermes-restart-2026-10-11.md)。

## 通用信封、身份与投递

原有对象事件符合 [event-v1.schema.json](./event-v1.schema.json)，`schema_version=1.0`；新增资料全文和处理覆盖使用明确协商的 [event-v1.1.schema.json](./event-v1.1.schema.json)，`schema_version=1.1`，见下文。破坏原有字段语义的修改升主版本；拒绝未知版本，严格1.0接收方不能静默接收1.1。ID 为不含用户内容的随机 UUID/ULID 或同等碰撞强度标识；样例的 `*-demo` 仅供阅读。对象 ID 在重连、转写、修订和补传中保持稳定；`event_id` 标识一次不可变事件，`idempotency_key` 标识一次逻辑提交，两者重试不变。

传输仅 HTTPS/WSS；Bearer 凭据不进入对象、日志或查询参数。服务端由已认证主体推导 owner，不信任客户端 `producer_id`、route 或 actor 声明。按用户、设备、电脑、Agent、项目和会话交集鉴权，ID 不是授权凭证。

| 身份 | 最小 scope | 可执行边界 |
| --- | --- | --- |
| 手机 | materials:write/read、messages:receive、requests:read、answers:write、receipts:phone | 只能本用户资料和目标设备；不能冒充 Agent 完成任务 |
| 电脑连接程序 | messages:receive、receipts:agent、tasks:update、requests:write | 仅登记电脑/Agent/project；运行时会话须校验归属 |
| 查询工具 | materials:read、changes:read | 不含命令执行权限；原音另授 audio:read |
| 服务器内部 | receipts:storage | 仅证明持久化；不能产生眼镜显示/用户回答/任务完成回执 |

令牌短期有效、可撤销、独立设备轮换；断线刷新后保留稳定主体 ID。401 刷新一次再补拉，403 停止该项并显示缺权限。请求体 <=256 KiB，原音走独立上传对象；短消息与大文件分队列。

`created_at/expires_at` 使用 RFC3339 UTC；手机展示用户时区。服务器时钟判定投递期限，手机可提前关闭输入，服务端最终裁决；建议容忍设备时钟偏差用于提示，不延长有效期限。过期事件不执行。资料事件过期只代表本次上传失效，不删除本地原件；可重新签发投递事件，仍保持 material_id/revision 做语义去重。

接收端在同一事务内校验、CAS、保存对象/幂等记录/outbox/游标，再返回 201；重复同键同 canonical JSON 内容返回 200 和原结果；同键不同内容 409 `IDEMPOTENCY_CONFLICT`。以 RFC8785 canonical JSON 的 SHA256 比较内容；参考测试使用固定字段顺序 JSON，仅演示语义，不提供生产级 canonicalizer。

至少一次投递，业务效果通过幂等/CAS 控制；不宣称网络 exactly-once。幂等键按 `(owner, producer_id, idempotency_key)` 隔离；事件 ID 同样唯一。幂等记录保存到 expires_at 后至少 30 天；资料最高修订和删除标记不能早于所有保留游标/客户端确认被清理。

客户端持久化 `queued / sending / server_stored / retry_wait / expired / blocked` 及 attempts、next_attempt_at、last_error、payload_hash；发送前落盘，收到确认后才推进。1、2、4、8 秒指数退避，封顶 30 秒并加 0–20% 抖动，遵守 Retry-After；429/5xx/网络故障可重试；400/403/409 不盲重试；期限到达停止。模糊结果先 GET 状态对账，不能改键重复执行。队列按主体分区，重启后读回未确认项；同主体修订按序，跨主体不要求总序。

## 1. 资料与修订

`material_id` 表示一段录音/智记/分析资料。`revision` 是整个资料的单调版本，`text_revision` 表示文字版本；修改文字、说话人、完整性或删除均创建新 revision。`base_revision=0,revision=1` 新建；后续要求 `base_revision=current,revision=current+1`。409 返回当前版本和冲突类型，由调用方重新取回、合并或确认，不能迟到覆盖用户更正。

资料包含绝对开始/结束、来源、完整性、带稳定 utterance_id 的相对毫秒文字段及说话人来源。检查 end>=start、段时间落在资料范围、说话人 ID 在段内稳定；`segment_cluster` 只表示段内聚类，不能自动命名“我”。无法区分用 null/unknown，重叠标 overlap。P23 扩展独立说话人映射和用户校正，不把跨日实名当成已有能力。

`audio.state=local` 不表示服务器已有原音；`stored_verified` 仅在服务端落盘、校验 sha256 与长度后可用。原音与文字独立确认。`missing/not_retained` 必须如实返回；有文字不等于原音已备份。现有三天清理不得直接作为新资料策略，P21/P22 增加可靠上传前保护。

删除是 `operation=delete` 新修订，utterances 为空；墓碑在 changes 游标中发布。删除旧修订不能复活对象；旧原音引用须失效。Agent 缓存按墓碑撤回，已产生外部副本的撤销不在接口保证内。

候选接口：`POST /v1/material-events`；`GET /v1/materials/{id}?revision=N`；`GET /v1/materials?from=&to=&keyword=&speaker=&limit=&cursor=`；`GET /v1/changes?cursor=&limit=`。服务端不透明游标绑定 owner/filter，按提交序号排序，分页回 `next_cursor,has_more,server_time,fresh_until`；游标失效返回 410 `CURSOR_RESET_REQUIRED`，通过快照和新游标重建，不能从最新位置静默跳过历史。

原音：创建 upload_id → 分片或独立 PUT → finalize SHA256/bytes → audio stored_verified。未 finalize 的 2xx 不允许本地清理。

## 2. 消息与回执

`message_id/revision` 表示不可变逻辑消息版本，`channel` 区分 command/question/answer/progress/result/cancel；route 明确电脑、Agent、project、stored session ID。改消息创建新版本，撤回发布独立事件，不覆盖已送达事实。

候选接口：`POST /v1/messages`；`GET /v1/inbox?cursor=&limit=`；`POST /v1/receipts`；`GET /v1/messages/{id}/receipts`。WS 仅用于唤醒，重连以持久游标补拉；确认游标只推进到连续已落盘的位置，不能因为收到更后面的消息跳过缺口。

| 回执 stage | 必须有的证据 | 不能推出 |
| --- | --- | --- |
| server_stored | 服务端事务提交、校验完成 | 眼镜已显示 |
| phone_received | 手机持久保存消息 | 镜片显示或人已读 |
| glasses_displayed | 经验证的设备显示回报，或实验中明确的人眼记录 | type33 发送 Promise 完成不够 |
| user_answered | 当前请求/版本的答案本地持久化及服务端接受 | Agent 已收到 |
| agent_received | 正确运行时会话接受答案且留痕 | 原任务已继续或完成 |
| task_resumed | 原任务等待点被解除并继续的运行时证据 | 任务最终成功 |
| task_completed | 发起任务的运行时报告结果/产物引用 | 发出去或存成功不够 |
| cancel_requested | 取消意图已持久化 | 实际取消成功 |
| cancelled | 运行时确认任务停止/请求撤回 | 不能撤销此前外部操作 |

这些是独立、可追加事实，不用一个笼统 sent/success 字段混合表示。接收端校验 actor scope、subject 类型与关联版本；允许离线延迟回执，去重 receipt_id，并保留时间，不用迟到回执倒退当前状态。`request.cancel` 撤回仅清理对应请求；不自动映射为任务取消。

## 3. 任务、请求与答案

`task_id` 绑定 route，不以最新活动窗口推断会话。`request_id/revision` 绑定 task 与 route；同一 task 可有多次提问。`answer_id` 是稳定答案 ID；提交必须携带 request_id、request_revision、task_id 和相同 route。服务端原子 CAS 把 pending/presented → answered 并保存首个答案，第二终端冲突返回 409 `ANSWER_ALREADY_ACCEPTED`，不再投递。请求版本变更、过期、撤回分别返回 `STALE_REQUEST/EXPIRED/REQUEST_CLOSED`。free_text 必须保留完整条件；option_id 只是可选结构，不能抹掉原文。

状态：任务 `queued → agent_received → running ↔ waiting_answer → completed/failed`，可进入 cancel_requested → cancelled，未知执行结果用 execution_unknown；过期任务只有尚未执行时可直接 expired，已经执行时需对账或取消。请求 pending → presented → answered 或 withdrawn/expired；答案记录、Agent 接收、任务继续分别确认。任务完成不能由客户端按钮推导。

候选接口：`POST /v1/tasks`、`GET /v1/tasks/{id}`、`POST /v1/tasks/{id}/cancel`、`POST /v1/requests`、`POST /v1/answers`、`GET /v1/requests/{id}`。电脑连接程序持久化 request_id/revision → runtime_request_id/qids、stored session → live session/gateway generation；会话找不到返回 SESSION_NOT_FOUND，禁止自动新建。owner 重启后 srq 等待点可能已失效，应 execution_unknown 并对账，不能用重放 prompt 冒充恢复同一等待点。

眼镜适配使用独立 `suggestUID → request_id/revision/session/generation/expires_at` 映射；business21 type34 仅给语义 accept/reject，`raw_action=null`。type4 普通通知不是答案。type35 code0 只能说明该实验/卡业务处理结果；不映射 task_completed。当前 P10 不连生产 request/answer 接口。

2026-10-11本设备观察：旋转选项后短按提交当前“添加/删除”，点头固定添加、摇头固定删除。生产映射须在请求创建时明确固定cmd1/cmd2各自对应的业务选项，不能使用“最近高亮项”解释头势；原厂“删除”文字本身不授权删除资料或取消任务。协议不提供输入来源，仍保持 `raw_action=null`；不能由本次二态结果推断任意多选已支持。

### 2026-10-12 问题期限与撤回收尾扩展

本地实现新增可选能力 `request_lifecycle_v1`，由已认证 `GET /v1/identity` 的 `capabilities` 数组声明。**此扩展尚未部署到腾讯云。** 事件 Schema 1.0、原问题信封、修订号和期限保持不变；不能因这项代码存在就认为线上已支持。

`POST /v1/requests/{request_id}/reconcile` 需要 `requests:write`，只接受 `{"schema_version":"1.0","request_revision":N}`。ID 沿用原问题稳定 ID；N 为当前正整数修订号，未知字段拒绝。请求不用新事件 ID：这是服务器对已保存问题的条件裁决，不是重新提问或续期。Bearer 和 owner 边界沿用现有规则。

服务器在同一个 `BEGIN IMMEDIATE` 事务内检查该 owner 的问题版本、父任务及服务器时间：

- `pending/presented` 且父任务为 `cancel_requested/cancelled/completed/failed/expired/execution_unknown`，问题变 `withdrawn`。
- 父任务仍可接受回答、但原问题信封期限已到，问题变 `expired`。
- 首答已接受的 `answered` 及已关闭问题保持原状态，不抹掉答案、不延长权限。

响应为 `{schema_version:"1.0",changed,reason,server_time,item}`。首次变更的 reason 为 `deadline/task_closed`，无变更为 null。item 与原问题详情相同，顶层 state 是当前有效状态；`body.state` 保留不可变发布值，不能据 body.state 重新打开已关闭问题。

关闭和独立回执原子落盘。回执绑定原 `request_id/revision/event_id`，`subject_kind=request`、`actor_id=server-lifecycle`、`error=null`，stage 为 `expired` 或 `cancelled`；后者仅表示请求撤回，不能推出任务进程已停止。receipt/event ID 由 owner、问题 ID、版本和关闭状态确定，重试只有一份。重复响应的 `changed=false`，其余有效状态和原回执保持；不要求整个 HTTP 响应逐字与首次相同。

无权限403、外 owner/不存在404 `REQUEST_NOT_FOUND`、版本变动409 `STALE_REQUEST`。连接程序在 stale 后只读刷新版本，按刷新状态处理；网络/5xx 保留等待记录，补发同一 ID/版本，禁止新建问题。已声明能力而接口失效时保留记录并报告失败，不静默切回旧逻辑。未声明能力的旧服务仅 GET 轮询，期限收尾能力不能据此宣称可用。

此轮没有常驻全库过期扫描。电脑每轮只为自己持久跟踪的问题调用此端点，离线时服务器仍在接受答案事务中拒绝过期/关闭父任务；电脑回来后补收口。手机按本地期限和已缓存父任务限制入口，提交前仍需刷新问题/父任务并由服务端最终 CAS。关闭未新增问题修订，已推进 inbox 游标的手机需要刷新已缓存详情，不能只等新问题事件。

[正常、重复、过期、离线恢复及取消中样例](./request-lifecycle.json)中的 `response_facts` 是完整响应的字段投影，供共同理解和实际服务测试使用，不是可直接发送的事件。完整实现与验证边界见[问题生命周期交付](../product/phase4-request-lifecycle-2026-10-12.md)。

## 错误与样例

错误统一为 `{schema_version:"1.0",error:{code,message,retryable,correlation_id,current_revision?,retry_after_ms?}}`；message 不含原话、密钥或服务地址。400 INVALID/INVALID_OPTIONS；401 UNAUTHENTICATED；403 FORBIDDEN；404 SESSION_NOT_FOUND/REQUEST_NOT_FOUND；409 REVISION_CONFLICT/STALE_REQUEST/ROUTE_MISMATCH/IDEMPOTENCY_CONFLICT/ANSWER_ALREADY_ACCEPTED；410 EXPIRED/REQUEST_CLOSED/CURSOR_RESET_REQUIRED；429 RATE_LIMITED；503 UNAVAILABLE；执行是否发生不明用 EXECUTION_UNKNOWN，禁止默认重跑。

| 样例 | 覆盖 |
| --- | --- |
| [正常](./normal.json) | 资料、消息、任务提问答案、六个分别表示的阶段回执 |
| [重复](./duplicate.json) | 重传同事件与第二终端回答竞争 |
| [过期](./expired.json) | 资料投递、问题和答案到期拒绝，原件保留 |
| [离线恢复](./offline-recovery.json) | 相同事件补拉、修订冲突、删除后旧补传不能复活 |

`tools/phase1/contracts.test.mjs` 校验 Schema 与参考状态账本，以及错会话、旧版本、未知选项、同键改内容。它不实现持久事务、鉴权、网络、完整任务状态机或生产服务器；这些分别是 P30/P40–44 的工作，不以样例测试替代验收。


## 2026-10-11 资料扩展 v1.1

2026-10-13 新增独立 [资料 v1.2](./material-v1.2.md)：当前资料的稳定说话人字典、人工标签及诚实拆句来源。完整 [Schema](./event-v1.2.schema.json) 与 [合成顺序修订](./material-v1.2.json)；1.0/1.1 保持严格，标签不静默降级、句子归属与标签来源分别表示。服务 identity 顶层以 `material_schema_versions` 声明支持版本，不能据本地实现推断线上已部署。

P21发现两个实际缺口：旧Markdown可能没有逐句时间；封口原音的文字可能只完成前几个窗。1.0严格Schema无法表达全文及文字覆盖，不能丢掉旧文字、虚构时间轴或以`completeness=complete`声称文字完整。1.0文件和四组生命周期样例保持原状；1.1保留所有既有字段语义，在资料body增加以下必填对象。消息/回执/任务/请求/答案的结构及鉴权边界不变。

| 新字段 | 语义 |
| --- | --- |
| `full_text.format/text/origin` | 当前修订的完整Markdown，origin为none/legacy/asr/user。没有可靠时间轴时原样保留全文，utterances可为空；查询不能只搜索utterances。原文不按请求大小静默截断。 |
| `processing.transcription_state` | unknown/pending/partial/complete，仅表示转写处理覆盖，不表示识别正确、已区分说话人或服务器已收到。 |
| `processing.covered_ms/source_ms` | 连续处理到的原音前缀和最近明确测量的原音时长，单位毫秒。包括处理过的静音，不能取最后一句结束时间或speechSeconds代替；不是从挂钟起止推测的长度。 |
| `processing.speaker/boundary` | 分别沿用unknown/pending/processed/unavailable与unknown/unverified/token_starts/no_speech，不能把VAD当作说话人区分。 |
| `processing.recognition_channel/user_edited` | unknown/mix/left/right/legacy_mix，以及是否有用户更正。声道不推出说话人身份，文字更正也不自动确认说话人。 |

unknown的两个覆盖值均为null；pending的covered_ms为0、source_ms可未知；partial/complete均为非负安全整数且covered_ms≤source_ms。complete要求两者相等、已测量当前原音全部帧且来源完整无中断；跨字段相等和当前来源一致性必须由业务验证，不仅依赖Schema。来源增长或从封口回到开放/中断时，旧complete降为partial；来源缩短、帧时长改变等无法确认旧覆盖的情况回到unknown，保留原有文字。历史资料缺少覆盖字段，不能只因文件封口补写为complete。

`completeness`继续表示采集来源完整性，独立于processing；原音完整而文字partial是正常可同步状态。已知采集中断用gap；只有原音缺失不能单独推出采集gap。audio.local及本地verified校验均不等于audio.stored_verified，转换器不会生成服务器object_id。删除事件full_text.text必须为空且utterances为空；旧不可变修订仍属于历史，查询默认应过滤墓碑，历史读取权限和留存另行执行。

实际转换入口为`RecordingService.localMaterialEvent(id, revision, identity)`，读取指定不可变修订。调用方必须先把随机事件ID、去重键、producer和创建/过期时间连同JSON耐久保存，再尝试发送；每次重试复用同一份事件，不调用随机/时钟默认值重新生成。补传按revision顺序满足base_revision CAS；不能只发最新本地版本却假定服务器已有前序。批量引导/压缩协议尚未实现。

事件UTF-8超过256KiB时报`MATERIAL_EVENT_TOO_LARGE`并保留本地原件；后续发送队列应显示阻塞原因。大文本分块尚未实现，禁止截断、偷偷拆成伪造新资料或报告存储成功。服务器拒绝未协商版本（`UNSUPPORTED_SCHEMA_VERSION`），不得通过删除full_text/processing降回1.0而丢信息。鉴权、RFC8785摘要、期限、事务去重、修订CAS、音频独立归档及回执规则全部沿用前文。

[1.1合成资料样例](./material-v1.1.json)分别展示封口但只处理10.02秒、全部处理、无时间轴历史全文、已知缺口及删除。它们是独立载荷示例，不是按序执行的事务日志；正常、重复、过期和离线恢复仍按前述生命周期约定。转换器没有网络发送、服务器事务、同步回执或查询实现，本批不能据此宣称P30/P31完成。

2026-10-11后续P30已新增[本机独立资料服务](../../rebuild/material-server/README.md)：实现真实SQLite事务、RFC8785摘要、鉴权/期限、CAS/语义去重和资料/增量查询，17项本机测试通过。资料响应只有server_stored；原音归档、手机联网同步和腾讯云部署仍未完成。删除优先于分页快照，changes不重新发布已删除旧正文，仅发布墓碑，序号可跳跃。该增量是观察接口，不是要求消费者连续写入CAS的提交日志。详见[验证记录](../product/phase3-material-service-2026-10-11.md)。

## 2026-10-11 队列实现补充（P40 服务端）

第2、3节的候选接口已在本机服务端实现，未改动本文其余语义；kind、body 字段、状态与回执阶段沿用 `event-v1.schema.json`，实现细节与证据见[服务README](../../rebuild/material-server/README.md)和[队列验证记录](../product/phase4-message-queue-2026-10-11.md)。与上文表格相比有三处明确补充，均以服务端实现为准：

1. **scope 扩展**：手机增加 `tasks:write`（发起命令任务）、`tasks:read`；电脑连接程序增加 `messages:write`（结果/进度）、`tasks:read`。原因是上文的最小scope表没有指明谁创建 task、谁写 result 消息，而候选接口 `POST /v1/tasks`、`POST /v1/messages` 需要明确主体。能写某类对象即可读回它（对账需要同一视图），读 scope 仍可单独签发。
2. **新增错误码**：409 `STATE_CONFLICT`（状态机不允许的跳转，含客户端试图发布 `answered`）、404 `TASK_NOT_FOUND`/`MESSAGE_NOT_FOUND`/`SUBJECT_NOT_FOUND`（回执指向不存在的修订）、409 `ANSWER_ID_CONFLICT`（复用答案ID且内容不同）。既有码 `STALE_REQUEST`/`ANSWER_ALREADY_ACCEPTED`/`REQUEST_CLOSED`/`ROUTE_MISMATCH`/`INVALID_OPTIONS`/`EXPIRED`/`IDEMPOTENCY_CONFLICT` 语义不变；版本号不因这些补充升级，因为新增码只用于本批新接口。
3. **服务端裁决**：`answered` 只能由答案事务写入；`server_stored`/`expired` 回执只能由 `receipts:storage` 写入，客户端自称不接受；回执只追加、按 `receipt_id` 去重且不修改对象状态（迟到回执不倒退状态）；`GET /v1/inbox` 提供按提交序号的投递流，游标绑定可见对象类型，可见性变化即 `CURSOR_RESET_REQUIRED`。

这仍是**本机服务端**补充：手机与电脑连接程序的实际收发、WS/推送唤醒、运行时适配与任务执行尚未实现，不能据此宣称 P40–P44 或 AC-ASK 完成。

## 2026-10-12 复审补充（本地候选补丁）

- task 初始 revision=1 必须为 queued；不能凭创建权限发布已运行/已完成状态，否则 409 STATE_CONFLICT。
- 新答案除了核对 request 版本、期限和 route，还必须核对父 task。父任务处于 cancel_requested/cancelled/completed/failed/expired/execution_unknown 时，409 TASK_CLOSED，不保存该答案、不触发原任务继续。已接受答案的同信封重试仍返回原幂等回执，不删除既有事实。此处只裁决新答案，不表示运行时已经停止。
- GET 对象的 receipts 是该 subject_kind + subject_id 的历史事实列表；每条保留真实 subject_revision。相同 ID 的不同 kind 互不混合；旧版本回执不能作为当前版本已显示/已执行的证明。答案回执仅归属于该 answer。
- 服务端本轮补丁尚未部署；电脑桥接器已有本机原型和复审修复，真实 Hermes、手机公网联调、完整期限与取消恢复仍未完成。当前边界及证据见[质量复审](../product/phase4-code-quality-review-2026-10-12.md)。
