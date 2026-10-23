# Hermes ACP 传输组件

`acp_transport.py` 使用安装版官方 `agent-client-protocol` Python SDK 启动 ACP stdio 子进程，提供 initialize、严格加载、prompt、取消请求、流式 session update 与确认退出。

`acp_transport.py` 本身仍只是传输层，不应单独声明可执行。`adapter_main.py --config <私有配置文件>` 已接桥接协议、独占 home、持久调度、原生 ACP 与提问工具。2026-10-12 按用户选择，新增 **skill + 固定 CLI** 主路径，真实 `kimi-k3` 模型与本机合成队列的原任务问答、排队、真实取消、取消后继续及正常重启已通过，见[真实模型与 CLI 记录](../../../docs/product/phase4-hermes-cli-provider-2026-10-12.md)。新增启动环境隔离与 CLI 登记 ready 检查。生产身份、手机/云端闭环、崩溃等待栈恢复仍未通过。旧 MCP 适配保留，其合成验证见[managed runtime 记录](../../../docs/product/phase4-hermes-managed-runtime-2026-10-12.md)。不把 ACP 回合结束自动视为任务完成。

追加[P44执行不明对账](../../../docs/product/phase4-runtime-reconciliation-2026-10-12.md)：实际ACP子进程异常退出不再永久挂起请求；只读 `reconcile_cli.py inspect` 提供不含正文的证据摘要，停止owner后显式 `apply` 以原生证据或明确人工声明裁决。原未知记录和审计保留，不重发prompt；人工声明不冒充原生完成，未暴露为模型工具。实际子进程退出/合成裁决/重启上传/后续FIFO联调通过，真实人工与生产验收仍待完成。

2026-10-13 增量：[真实模型云端 CLI 集成](../../../docs/product/phase4-cloud-hermes-2026-10-13.md)已通过；[原答案接收核对](../../../docs/product/phase4-answer-intake-reconciliation-2026-10-13.md)另外通过公网真实模型专项。`answer_intake_probe_v1` 只读查询原问题和确切答案，回复丢失后不再次调用 onAnswer；接收回执与原任务继续/完成分别报告。手机角色仍由电脑测试驱动代发，正式登记、真机闭环和硬崩溃等待栈恢复继续待验收。下文各历史记录的“未验证”限定于当时证据。

## 已实现的约束

- 构造时登记 session ID、project ID、已有 cwd 和明确 HERMES_HOME。不存在注册或项目不一致时拒绝。
- 调用 `session/load` 前只读查询既有 `state.db`：ID 必须存在、source 必须为 `acp`、cwd 列及 model_config.cwd 必须与登记目录一致。不会创建缺失数据库，不改项目来迁就传入路由，不调用 `session/new` / `session/resume` 后备。
- 只读数据库连接显式关闭，避免 Windows 文件句柄残留。仅验证安装版本所用表结构；其他版本需要重新核对。
- 同一传输实例不同时向同一 session 提交第二个 prompt，返回 `ACP_SESSION_BUSY`。不能把 Hermes 内存排队返回的 `end_turn` 当作执行完成。持久忙时队列由后续适配器负责。
- `prompt` 只接受非空普通文本，拒绝直接透传 `/reset` 等 slash 命令。stdout 由官方 SDK 协议使用，子进程 stderr 丢弃；外露异常为受限错误码。
- 未接权限交互时默认拒绝 permission request，不自动批准。正式版仍需要把权限与普通业务提问分别处理。
- `cancel()` 仅报告 `cancel_requested=true,cancelled=false`。`prompt` 后续的 `stop_reason=cancelled` 只记录观察到 ACP 回合取消，不声称所有派生工具已终止。
- **所有 prompt 结果均带 `task_completed=false,completion_verified=false`**。已实测安装版执行抛异常时仍返回 `end_turn`，甚至附带 Error 文本；必须由运行时提供额外的可靠完成事实。不能靠文字猜测成功。

## 验证

结果见 [verification/result.json](./verification/result.json)：16 项传输防护 + 10 项安装版真实 stdio 检查。后者使用真实官方 SDK、真实 Hermes ACP handler / SessionManager / SQLite、独立子进程；只把 Agent body 换为合成代码。该组未使用模型、工具、MCP attachment 或用户会话；另外的实际 MCP 联调见文末。

复跑入口为项目 `tools/phase1/verify-hermes-transport.py`，使用已准备的 Hermes Python，以 `-I -S -B` 启动并传入已安装源码目录 `--source`、同一环境的依赖目录 `--site-packages`。不经会自动引导或修复的 Hermes launcher，不下载依赖。本轮实际运行时为 Python 3.14；固定源码及项目代码哈希在报告中。

## 尚未具备的保证

注册表和只读预检**不是与其他 ACP owner 的互斥锁**。不能把本模块直接指向用户正被另一宿主使用的会话并声称安全接管；需要独占运行时管理策略与相应实验。CLI/TUI 原任务也不因历史在同一 DB 中就自动兼容 ACP。

失去连接或调用被取消时，prompt 可能已经开始执行；返回 `ACP_PROMPT_OUTCOME_UNKNOWN` 或宿主取消异常后不得自动重发。后续执行适配器必须先持久准备操作，并通过稳定 operation ID 对账。历史重载不是恢复旧工具等待栈。

## 运行时持久账本

`runtime_journal.py` 是运行时自己的 SQLite 操作/事件账本，区别于电脑连接程序的网络 outbox。已经实现：

- 数据库 application_id / schema 3 / server、owner、producer、computer、agent 固定绑定；外来 SQLite、链接文件或身份不一致拒绝接管。schema 1/2 核对绑定后事务升级，保留原领取/事件/ACK，并追加取消意图、原生结果、进程关闭证据及答案消费标记。
- `admit(operation_id, delivery_id, source, payload)` 在执行前保存原投递、项目/会话和请求正文。相同操作同字节含义重放返回原记录；更改内容/来源拒绝；一个 delivery 不可用第二个 operation ID 绕过去重。
- `claim()` 以事务 CAS 从 admitted 到 claimed，真实双进程只能有一个成功。进程退出后 claimed 不自动回退，不以“锁已释放”推断任务没执行。
- `append_event()` 持久保存延迟事件；重复相同 ID/内容不新建，改变内容拒绝。`events()` 按顺序重复提供未 ACK 事件；`acknowledge()` 全组检查后写 ACK，保留 tombstone，未知 ID 不会让同组其他事件丢失。
- `settle()` 将不可变终态与对应事件放在同一事务提交；事件冲突会一起回滚，重复终态不得覆盖。但 completed 的真实性仍由调用者提供证据，账本不替模型判断，不把 ACP `end_turn` 当作证据。

16 项检查及源码哈希见 [journal-result.json](./verification/journal-result.json)，包含实际子进程领取后退出、双进程竞争、重开数据库、ACK 重放、事务回滚和外来文件保留。新增接收事件原子保存、FIFO 待执行查询、仅未领取任务的终结接口及原命令期限保留；它们尚未接入实际调度器，不代表自动取消/过期已完成。详细边界见[本轮记录](../../../docs/product/phase4-operations-dashboard-2026-10-12.md)。复跑 `tools/phase1/verify-hermes-journal.py`，使用准备好的 Python 加 `-I -S -B`；不需要模型或 Hermes SDK。

账本已接入 MCP 工具和实验执行适配器；未做数据归档、容量管理、跨 OS 账户权限和断电磁盘验证。独占 home 的实际双进程及 owner 硬退出验证见 managed runtime 记录；事务 claim 本身仍不能代替所有权。

### macOS / POSIX 进程托管的限制

Mac 上用 `PosixProcessJob`（配合 `session_exec.py` 让 ACP 子进程成为会话首进程）代替 Windows Job。成员按“同一会话 + 仍挂在其父进程链上”认定，见过的成员一直记到确认退出为止；工具自己调用 `setsid` 时，只要父进程还在也仍被跟踪。它比 Job 弱：
- owner 被强制杀掉（例如 `kill -9`）时，没有内核机制替它结束整棵进程树；
- 关闭前脱离会话、并且父进程已退出的孤儿进程可能逃出跟踪；
- 不限制资源，也不隔离文件系统或网络。工作区权限（`io-workspace-cli-v1`）的边界靠 ACP 的 `accept_edits` 和许可拒绝，不靠进程托管。

因此 Mac 适合开发和验收，不应作为强隔离的生产执行环境；需要硬保证时仍以 Windows Job 为准。

## 持久提问与 MCP 工具

`question_tools.py` 使用本机安装的 MCP 2.x low-level SDK，经 stdio 只暴露 `ask_user` / `wait_answer`。它不是 skill、模型运行器、常驻网络连接程序或完整执行适配器。

启动环境变量 `TURBOIO_QUESTION_CONFIG` 指向私有 JSON 文件，内容为 `journal`（已有 SQLite 的绝对路径）、`binding`（账本相同五项身份）、`operation_id`（已 claimed 的原操作）。由未来适配器创建和登记；不要把配置写入共享 MCP 全局设置，不要让模型选择 journal/operation/route。工具进程拒绝缺失数据库、未知/未领取操作、外来绑定、配置链接文件和未知参数。当前没有部署到用户 Hermes home。

- `ask_user(question_key, question, mode, options, expires_at)`：问题键须稳定，重试复用原内容及期限。mode 为 choice（2–4 个唯一 option_id/label）或 free_text（options=[]）。期限为 UTC ISO 时间，以 Z 结尾，首次创建须在未来一小时内。request/runtime_request/event ID 从 operation/question_key 稳定派生；问题等待行与原 delivery 的 request 动作在同一事务保存。返回 pending 仅证明运行时账本接收，不能报服务器落库或眼镜显示。
- `wait_answer(request_id, wait_seconds=30)`：限本操作，等待 0–30 秒；答案到达可唤醒当前调用。调用取消只结束等待，不删除问题或取消任务；重开 MCP 进程可读取既有答案，**不意味着恢复原 Agent 调用栈**。
- 适配器内部 `record_answer(operation_id, request, answer)`：校验请求 ID/修订、runtime_request_id、task/project/session 路由、问题及选项；首答不可改，完全相同重放可对账。必须传经认证服务器返回的队列对象，尤其 stored_at，不能把眼镜原始动作或模型参数伪装成服务器事实。
- `deadline_elapsed=true` 只表示本地已过期限，state 仍可 pending；需要适配器向服务器裁决。服务器在期限前接受、离线后才送达的答案仍可保存；按服务器毫秒精度核对 stored_at，不由接收电脑的到达时间否决。服务器确认 withdrawn/expired 后才由 `close_question` 关闭。已终态操作返回 operation_closed，禁止据此继续执行。
- Bridge 的 request 动作新增可选 expires_at：保留原期限进入信封和同字节重试；非法/已过期/超过一小时拒绝并整体回滚动作，不把问题期限延长。尚未实现过期请求的自动撤回与归档，当前按保留并停止策略处理。

证据：[question-result.json](./verification/question-result.json)。28 项账本/工具回归（含账本 16 项）和 9 项真实 MCP stdio 检查通过；后者使用两个真实 Python 进程、私有真实 SQLite、合成答案。答案落库与原任务继续分开：只有实际 wait_answer 消费答案才产生 running/task_resumed 事件，重读不重复产生。安装版 Hermes 的实际 ACP/MCP attachment 与本机认证队列接线已另行验证；真实模型及云端/手机/眼镜任务闭环仍未验证。

复跑：使用已准备的 Hermes Python，`-I -S -B tools/phase1/verify-hermes-questions.py --site-packages <同环境依赖目录>`。探针显式加入已安装 win32 依赖路径并在两个进程初始化事件循环后阻断网络，不下载 SDK、不运行 Hermes launcher、不改用户会话。

## 原生 Hermes 接线与 Windows 进程树

[acp-question-result.json](./verification/acp-question-result.json) 记录安装版实际 ACP/MCP 注册、session 工具授权目录、model_tools.handle_function_call 和真实 MCP 子进程联调；默认 tool_search 和直接工具表两个配置各 9 项通过。合成模型主体在同一个 run_conversation 中提问并等待答案，再继续原调用；原 session 数据库确认只有一条用户提示及答后结果。**模型主体和答案仍为合成，不构成正式 Agent/服务器端到端。**

默认 tool_search 会把 MCP 工具折叠到 tool_call；不能用模型表缺少直接工具名判失败，也不能用全局 registry 有名字判已授权。正式接入要检查 session 的未折叠目录与可用调用路径，不关闭用户的工具搜索来迁就本模块。

新增 `WindowsProcessJob` 与 ACP 的可选 process_job 参数。在 initialize 前使用子进程底层 Popen 的既有内核句柄归入 Job，避免 PID 复用；关闭时确认所有成员归零。实际 owner 硬退出后子/孙进程均退出的 3 项 Windows 测试通过。详情、边界和复跑见[本批说明](../../../docs/product/phase4-hermes-acp-mcp-2026-10-12.md)。该保护不代替独占 home/session 所有权，不证明取消外部操作或恢复原等待栈，也不保证任意 launcher 在归入前创建的子进程被捕获。
