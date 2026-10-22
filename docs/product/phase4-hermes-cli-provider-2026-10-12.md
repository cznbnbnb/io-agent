# P42：skill、固定 CLI 与真实 Hermes 模型原任务问答

日期：2026-10-12。用户选择 CLI 方向，手机暂时断开。本批不操作手机、不更新 Excel、不改变生产服务或用户既有 Hermes home/会话。真实模型为当前配置的 `kimi-k3 / custom:token-share`，安装源码仍固定于 `08165d58931841cee713468ae89032af7c57060a`。

后续：[P44执行不明检查/对账](./phase4-runtime-reconciliation-2026-10-12.md)已实现行政CLI和实际异常退出/合成裁决恢复联调；ACP退出观察修改后，真实模型7项链路已再通过。当前 cancel 报告会话为 `io-acp-20a86b654ee34f80b2c569bdc8493699`，本段以下保留前一轮取消测试的时间与会话作为历史记录。

## 结果和边界

真实模型在独立登记的 ACP 会话里调用固定 CLI 提问，保持原调用等待。本机认证合成队列传回随机测试答案，原任务消费答案、生成独立的 task_resumed 回执，再实际完成并返回含该随机答案的结果。第二项任务先持久排队，随后执行。正常停止并重启 bridge/adapter 后，已完成结果没有重复。

这是**真实模型、真实安装版 ACP、真实 CLI 子进程及本机 HTTP/SQLite 队列的闭环**。队列主体、任务和答案均为测试数据，尚非手机、腾讯云和眼镜端到端；不包含办公工具、CLI/TUI 旧会话接管、崩溃等待栈恢复或8小时稳定性。同日追加的真实模型取消验证见下文。

## 实现分工

- skill：`rebuild/agent-bridge/skill/turboio-ask-user/SKILL.md`。未安装到全局 skill 目录，本次模型实验用明确测试提示调用工具，不冒充 skill 自动发现已验收。
- `cli_tools.py`：当前固定版本 Hermes 原生工具注册表提供 `io_ask_user`、`io_wait_answer`、`io_question_status`。处理器只启动固定 Python CLI，参数 JSON 走 stdin，操作配置由宿主绑定；模型没有任意终端或命令选择能力。这是版本固定的注册表适配，不宣称任意 Hermes 版本支持。
- `question_cli.py ask|wait|status`：只依赖标准库和已有账本。status 不消费答案；wait 实际消费才产生继续原任务回执。重复问题键/内容保持同 ID，跨 operation 读取拒绝，不能通过参数更改 journal、会话或注入答案。
- 连接程序负责可靠收发、去重、积压和对账；ACP 负责加载指定既有会话、prompt 和取消。skill/CLI 不替代这两层。
- 新登记默认 `io-question-cli-v1`，不启动 MCP 服务。旧 MCP profile 仍保留为可选适配，其回归未移除。

## 独立登记与工具权限

`enroll_home.py --config <私有登记文件>` 是准备动作，投递任务时不调用它补建缺失会话。home 必须不存在，parent/cwd 明确且已存在，绑定包含 server/owner/producer/computer/agent，项目 ID 单独登记。已有 home 拒绝采用。

从显式配置只导入选中 HTTPS custom provider 的 name/base_url/api_key/api_mode 和模型。未复制 auth.json、.env、其他提供方、原历史、hooks、skills 或办公工具。新 home 在写密钥前移除继承 ACL，仅当前账户、SYSTEM 和管理员可访问（POSIX为0700）。`rebuild/agent-bridge/private/` 已 Git 忽略，凭据不进 argv/输出/提交。

使用实际 SessionDB 创建新 home 中的 ACP 登记行，随后验证传输器能只读核对既有会话 source/cwd、独占锁可获得，再写 ready 标记。创建行是显式准备，不是投递失败后的替代会话。失败保留不完整目录，不覆盖或自动重试。生产仍需新的具体身份绑定和凭据，不能采用测试主体。

追加 `runtime_environment.py`：登记进程及原生子进程清除继承的全部 `HERMES_*` / `TURBOIO_*`（大小写不敏感），只重新设置明确 home、禁用自动安装/配置 MCP 和当前 runtime 配置；保留 OS、代理与既有 Python 设置。新目录先保护 ACL，再运行安装版 bootstrap，避免准备过程使用启动终端的旧 home。CLI profile 在 adapter 启动和原生加载两处要求准确匹配会话的 ready 标记；只写出 runtime/config、未完成预检的目录拒绝投递。旧 MCP profile 保留其原有明确登记和独占检查。

CLI profile 每次模型调用前精确核对可见 schemas、原始可派发 catalog、valid_tool_names 和启用 toolset，只允许三个固定 CLI 工具；动态搜索桥或额外 terminal/MCP/办公工具拒绝。它限制工具范围，**不是针对恶意安装源码的操作系统沙箱**。

## 真实缺陷和修复

原 adapter 在 Windows 下用控制台文本编码输出 JSON-lines，中文问题在 Python→Node 路径被替换，导致服务器问题与原账本不一致，答案匹配被拒。原英文合成样例没有暴露此问题。adapter 和 CLI 现均显式用 UTF-8 bytes 收发，未放宽答案的 task/route/问题/版本/期限校验。

真实 CLI 回归强制 `utf8=0`、非 UTF-8 环境，包含中文、表情、附加条件及一次性消费。既有 ACP/MCP 本机集成也加入中文问题/结果和非 UTF-8 控制台，验证兼容和取消/正常重启。

另纠正验证代码问题：MCP 真实名称为 `mcp__server__tool`；路由字典不应依赖 JSON 字段顺序；模型结果可能在标志与答案间加空白，因此检查同原任务结果中同时包含标志和不可预测的实际答案，严格的路由、继续和完成回执检查保留。

前四次未通过记录保留于 `hermes-real-provider-attempt1..4-2026-10-12.json`：工具名白名单拒绝、字段顺序误判、真实编码缺陷、结果格式误判。不确定原任务未自动重跑，后续均为隔离的新测试任务。

## 验证证据

- `rebuild/phase1/hermes-real-provider-2026-10-12.json`：5项真实模型链路检查通过，含源码 SHA。单次登记2114ms、适配器就绪643ms、首次问题14934ms、两项任务合计32224ms。含模型/网络、存储和轮询时间，不是 MCP/CLI 性能对比或内存结论。
- `rebuild/phase1/hermes-cli-enrollment-tests-2026-10-12.log`：11项登记/权限和真实 CLI 子进程回归通过，含中文、表情、去重、跨任务隔离、status不继续、wait恰好一次继续及输入限制。
- `rebuild/agent-bridge/hermes/verification/managed-result.json`：11项调度回归及6项实际安装版 ACP/MCP 本机集成通过，模型为合成，已加入中文和非 UTF-8 覆盖。与真实模型结果分开报告。
- skill-creator 的 `quick_validate.py` 检查通过；不代替自动发现或日常使用验收。

### 同日追加：真实模型取消与会话隔离

- `rebuild/phase1/hermes-real-provider-cancel-2026-10-12.json`：最新代码8项真实模型检查通过，重新验证原任务问答/FIFO/正常重启、运行中和排队中取消、原问题同版本撤回、迟到答案拒绝及取消后下一任务。模型为 `kimi-k3`，独立测试会话 `io-acp-6fcc933366b34abbadb30fa6b17be24b`。
- 运行中取消先持久 `cancel_requested`，随后收到原生返回结果 `interrupted=true, completed=false`，记录所属进程树已关闭，才产生 `cancelled` 终态与回执。排队取消没有 `native_turns` 行，即未进入模型。两个取消任务均无成功结果、无 task_resumed/task_completed。问题另以原版本变为 withdrawn 并写请求回执；迟到答案以 `REQUEST_CLOSED` 拒绝。此扩展仅本机验证，未部署；关闭请求不能替代原生任务取消证据。
- 最新追加取消场景约17843ms，包含提问、轮询、排队取消和运行中取消，并非单次中断延迟或性能承诺。当前实验不证明正在执行的外部办公操作可撤销，也不包含手机取消入口的体验验收。
- `rebuild/phase1/hermes-cli-environment-tests-2026-10-12.log`：14项隔离/登记/真实CLI回归通过，新增混合大小写环境选择变量、未完成/错会话 ready 拒绝与兼容模式检查。初次沙箱运行因临时目录文件权限失败，正常本机权限下重跑通过，没有据权限失败修改业务逻辑。
- 此前11项调度单元和6项安装版集成作为历史证据保留。本次另验证8项实际 ACP/MCP 过期等待及9项崩溃对账集成，模型为合成，见[问题生命周期交付](./phase4-request-lifecycle-2026-10-12.md)。当前报告保存对应源码哈希，最初5项真实模型报告不用于证明本次改动。

复跑追加场景：`node tools/phase1/verify-hermes-provider.mjs --run-provider --with-cancellation`。写入单独 cancel 报告，原5项报告不覆盖。没有生产身份、手机或办公工具副作用。

真实模型复跑须显式 `node tools/phase1/verify-hermes-provider.mjs --run-provider`。默认已有 prepared Python/source/config，可用参数指定环境；不安装新依赖。私有测试 home/日志/SQLite 留在忽略目录。CLI 宿主设置 `TURBOIO_QUESTION_CONFIG`，执行 `<prepared-python> -I -S -B rebuild/agent-bridge/hermes/question_cli.py ask|wait|status`，JSON经stdin传入。

剩余：生产身份/凭据、真实云端出站、手机任务页启用/首答/取消及页面收口的真机验收、真实人工对账与bridge不明投递恢复、长时间稳定性和官方基础差距。一次真实模型复跑的未分类失败已保留，并列入长稳定位；后续独立任务复跑通过不能抹掉此记录。手机断开仅暂停真机部分。P42真实模型及P44取消/对账单项有进展，P43/P44和AC-ASK/AC-VOICE/AC-OFF未关闭。
