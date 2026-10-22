# P42 Hermes 接口补测（2026-10-12）

## 当前结论

安装版 Hermes 确有可复用的外部接口和持久投递组件，但**真实 Hermes 适配器尚未完成，原任务提问、回答和重启恢复尚未验收**。本轮没有调用真实模型、执行工具、连接用户会话或修改 Hermes 安装与配置；没有把新建会话当成恢复原任务。

固定安装源码：`D:/APP/hermes/hermes-agent`，提交 `08165d58931841cee713468ae89032af7c57060a`，检查时工作区干净。沿用此前记录的显示版本 `0.21.5+9117.g08165d5`，本轮直接调用管理环境 Python，避开可能引导安装或自动修复的 launcher。每份实验报告记录实际使用源码的 SHA-256；结论仅对应此安装版本。

## ACP：支持外部宿主，但不是现有任意会话的替代入口

本轮实际调用安装版 ACP handler、SessionManager 与临时真实 SessionDB，使用合成 Agent factory，禁用模型、工具、网络和 MCP attachment。6 项检查通过：

| 观察 | 对实现的约束 |
| --- | --- |
| `load_session` 对未知 ID 返回无结果，不创建 | 采用严格加载；找不到必须停止并报告 |
| `resume_session` 对未知 ID 会创建新会话 | 禁止把它作为缺失会话的恢复后备 |
| 两个 ACP 会话能由新 manager 从同一临时 DB 恢复各自历史 | 证明组件级历史隔离；不等于原阻塞工具栈或 owner 进程恢复 |
| ACP manager 不恢复 source 为 CLI 的记录 | 不能声称能透明接管用户已有 CLI/TUI 原任务 |
| 忙时追加只保存在 manager 内存，重载后丢失 | 电脑连接程序必须保存自己的投递状态，不能仅依赖返回“排队” |
| 加载路径调用的 `update_cwd` 会持久修改已有项目绑定 | 接入前先核验项目，不能借加载操作悄悄更换项目 |

本轮没有测试 ACP stdio wire、真实模型、权限交互、外部提问工具或真实任务续接。安装版原生文档说明 ACP 是外部宿主接口；TUI 文档则明确 `HERMES_TUI_GATEWAY_URL` 属于内部 dashboard wiring，不是公开远程接入开关。不能把内部 `/api/ws` 包装成稳定公共协议而省略生命周期和鉴权设计。

证据：[探针源码](../../tools/phase1/probe-hermes-acp-routing.py)、[结果与源码哈希](../../rebuild/phase1/hermes-acp-routing-probe-2026-10-12.json)。

## 原生 mailbox：有持久回执，目标是固定 Bot Chat

安装版 `tools/bot_live_delivery.py` 与 TUI 的 `_poll_bot_live_delivery_once` 共同实现外部消息投递。临时真实 SessionDB、真实 active-session lease、真实磁盘回执和独立 claim 子进程的 7 项实验通过：

| 观察 | 能证明 / 不能证明 |
| --- | --- |
| canonical discovery 只选择标题为 `Bot Chat` 的会话及其当前 lease/live ID | 不提供任意指定原任务的发现路由 |
| 相同 delivery ID 与相同 owner/message 重投返回原记录；改变正文或 owner 拒绝 | 可对账投递入队；入队不是模型已接收或任务已完成 |
| sequence 保证 FIFO，claimed 不再次领取；新 lease 无法领取旧 owner 输入 | 防止偷偷切到新 owner；不能自动解决 owner 消失后的积压 |
| queued 可持久取消；claimed 返回原状 | 此 API 不等于运行中取消，必须另外实现取消与确认 |
| terminal 回执可重复读/相同完成；不同结果拒绝覆盖 | 完成事实可审计，不能从本实验推断真实执行成功 |
| 子进程实际 claim 后以 73 退出，记录继续为 claimed，重投仍为 claimed | 不明结果不会自动重复执行；没有自动恢复原任务 |
| lease release 后不再发现为活 owner | 组件识别所有权释放；没有运行真实 TUI consumer |

源码还明确：外部导入回合的 crash marker 关闭普通 auto-continue，由 mailbox 管恢复和回执身份。这与此前 P11 的普通 auto-continue 重投 prompt 结论并不冲突，不能跨路径移植结论。

不得通过改用户会话标题为 Bot Chat、直接写用户 mailbox、忽略 owner pin 或 CLI fallback 来绕过指定原任务要求。当前可复用其“稳定操作 ID、先查回执、queued/claimed/terminal、不明结果停重投”的机制思路；尚未把该私有 Python 组件声明为稳定受支持公共 API。

证据：[探针源码](../../tools/phase1/probe-hermes-mailbox.py)、[结果与源码哈希](../../rebuild/phase1/hermes-mailbox-probe-2026-10-12.json)。真实进程实验仅为 claim worker，非真实 Agent owner 崩溃恢复。

## ACP stdio：新增真实协议补测与传输代码

新增[传输组件](../../rebuild/agent-bridge/hermes/README.md)，使用安装版官方 ACP SDK；严格加载前只读核对注册 ID、source 与 cwd，不调用新建/宽松恢复后备。报告及代码哈希见[验证结果](../../rebuild/agent-bridge/hermes/verification/result.json)，真实 stdio 细节见[探针报告](../../rebuild/phase1/hermes-acp-wire-probe-2026-10-12.json)。

10 项代码防护测试通过；另有 10 项真实 stdio 检查通过，覆盖初始化、未接权限默认拒绝、未知/CLI/错误项目拒绝、原 ACP 会话加载及更新、执行异常、忙时保护、原生队列返回、取消请求和观察到取消、确认子进程退出，以及未创建替代会话。真实 stdio 使用原生 Hermes handler 和真实 SQLite，Agent body 仍为合成代码，没有模型/工具调用。

**新增关键证据：`end_turn` 既可能来自执行异常，也可能只是忙时入队。** `_run_agent_turn` 会将异常变成 Error 文本，`prompt` / `_finish_turn` 仍可返回 `end_turn`；原生第二个忙时 prompt 返回时第一个任务还在运行。传输组件不把该字段转换成 `completed` 或 `task_completed`，需要另加可靠的运行时完成证据。源码约定不据此视为 Hermes 的 bug，但它与本项目任务回执含义不同。

SDK 通知由独立 dispatcher 调度，RPC response 返回不保证宿主 update callback 已执行；测试需等待具体通知，正式适配器需要持久事件顺序，不能用“收到 response 后缓冲区为空”推断没有产物。

本组件尚未取得与外部 ACP owner 的运行所有权，也未接运行时持久 outbox/MCP 提问工具；不能直接挂为可执行 bridge adapter。CLI/TUI 任意原任务支持范围保持未完成。

另已完成独立 `runtime_journal.py`：稳定 operation/delivery 绑定、原子领取、claimed 不明结果保留、持久事件/ACK tombstone、终态与事件同事务提交。真实双进程和进程退出等 12 项通过，见[运行时账本验证](../../rebuild/agent-bridge/hermes/verification/journal-result.json)。仍需将其与 ACP、MCP 提问、答案等待和 bridge adapter 接线；这不等于真实 Hermes 已能继续原任务。

## 下一步实现约束

1. 原任务路由继续采用明确 project/session 绑定；未知、关闭、所有权不明均拒绝，不自动建新会话。ACP 新建专用会话只能作为明确登记的新任务入口，不能替代旧任务恢复。
2. 连接程序已加入可选的 poll/ack 异步事件承载：投递来源先保存，事件去重事实与 outbox 原子保存后 ACK；已用独立测试子进程验证延迟提问、答案回原任务与完成状态。真实 Hermes 的持久事件产生、提问工具等待及恢复仍待实现；不能让 `onItem` 一直等待用户回答，阻塞连接程序读取该答案。协议细节见[连接程序说明](../../rebuild/agent-bridge/README.md)。
3. 引入运行时稳定 operation ID 和查询回执后，才能把 `DISPATCH_UNCERTAIN` 从“保留并停止”升级为自动对账。已知 claimed 仍不得自动重投。
4. 取消请求、运行时确认取消、任务完成分别发事实；协议拒绝和进程死亡不得报完成。原始工具等待点丢失时明确报告，不能将历史重放标为 `task_resumed`。

三份探针均在项目 `rebuild/phase1/runtime-home` 下创建临时目录并清理。复跑使用安装环境 Python 的 `-I -S -B`，传入 `--source`、`--site-packages` 和项目内 `--output`。报告不包含凭据、用户正文或用户会话。不得在真实 Hermes home 复跑合成写入。
