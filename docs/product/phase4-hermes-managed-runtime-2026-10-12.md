# P42/P44 实验适配器：本机队列、原会话等待与结果回传

后续进展（2026-10-12）：按用户选择新增 skill + 固定 CLI 主路径，真实模型的本机原任务问答/排队/正常重启已通过，详见[CLI 与真实模型记录](./phase4-hermes-cli-provider-2026-10-12.md)。本文件下面保留原 MCP 合成验证边界，不能用它代替后续真实模型证据。

同日追加：[执行不明对账入口](./phase4-runtime-reconciliation-2026-10-12.md)已实现只读检查及停止owner后的明确裁决，并修复ACP子进程异常退出后的等待挂起。实际异常退出/合成裁决/HTTP回执/FIFO恢复通过。下文“尚无人工入口”是当时状态；真实人工审核、生产接入和等待栈恢复仍未验证。

日期：2026-10-12。承接 [ACP/MCP 接线](./phase4-hermes-acp-mcp-2026-10-12.md)。本批已完成可执行的实验适配器及真实本机链路，**模型主体是合成替身，尚不构成真实 Hermes 模型、手机或眼镜任务端到端验收**。生产服务与用户 Hermes 安装、普通 home、既有会话均未修改；Excel 未更新。

## 代码及行为

| 位置 | 最终行为 |
| --- | --- |
| `adapter_main.py` | 独立 JSON-lines 进程；hello/item/answer/closed/events/ACK/shutdown。网络连接与模型运行分离，原 prompt 等待时仍可接收其他任务及答案 |
| `managed_home.py` | 仅接收显式登记的独立 home 和 session/project/cwd；SQLite 独占 owner 锁，第二进程拒绝；硬退出后可重新获得同一锁文件，不删锁、不猜 PID |
| `runtime_scheduler.py` | 持久 FIFO，全 home 串行运行，避免安装版全局 cwd/MCP 注册交叉；状态反馈和结果消息不成为新 prompt；开工前检查原命令期限，拒绝隐式新建会话及 slash 命令 |
| `native_entry.py` / `pinned_runtime.py` | 固定安装源码 commit `08165d58931841cee713468ae89032af7c57060a` 且工作树干净；调用官方 ACP handler。项目包装器观察原生 run_conversation 返回，未修改安装源码 |
| `native_observer.py` | 校验原始 prompt；只有完整 engine 标志、无失败/中断/部分/介入/清理错误，并确认自有进程树退出后才 completed。该观察点为固定版本的内部方法，不能称为所有 Hermes 版本的受支持完成 API |
| `runtime_journal.py` schema 3 | 在事务迁移中保留旧记录；追加取消意图、实际 native start/return、进程关闭证据和答案消费标志。已 claimed 任务不因重启自动重发 |
| `question_tools.py` | 接收答案只报告答案持久接收；真实 wait_answer 消费后才发布原任务 running 与 task_resumed，ACK 丢失或重复消费保持稳定事件 ID |
| `bridge.mjs` | 允许有限的 progress/result 消息动作；task/route 由原投递推导，适配器不得改指向。cancel_requested 时丢弃尚未发布的迟到提问与运行进度，仍接受确认取消/实际终结 |
| `adapter-host.mjs` | 隐藏子进程窗口；声明支持 graceful_shutdown 时先要求清理，等回执后确认进程退出；超时/协议失败仍关闭，不把 kill 请求当退出证据 |

取消请求、ACP 中断观察、原生中断结果、进程树关闭与服务器 cancelled 分别处理。完成也不是“返回 end_turn”：安装版此前抛异常仍返回 end_turn 的事实继续作为防护依据。结果超过限制不静默截断后报完整交付，而是保留未知状态。

## 配置和运行边界

生产入口为准备好的 Python：`python -I -S -B rebuild/agent-bridge/hermes/adapter_main.py --config <私有绝对路径>`。不通过 Hermes launcher 引导、不下载依赖。配置仅允许 home、journal、binding、sessions、source、site_packages 六项，binding 是 server/owner/producer/computer/agent 五项固定身份；sessions 是 session ID 到 project_id/cwd 的显式注册表。

home 必须已存在且含完全匹配的 `.turboio-managed.json`（schema=1、binding、sessions）。该程序不自动接管普通用户 home，也不在投递阶段创建缺失会话。ACP 会话必须已存在于该 home 的 state.db，source 为 acp，cwd 与登记一致。配置与逐操作问题工具配置在本机私有目录中，模型无权选择 journal、operation 或 route。工具配置不加入用户全局 MCP 配置。

能力声明区分 original_live_wait=true 与 restart_wait_stack_recovery=false。原调用仍活着时，答案可返回并继续；owner 死亡后，重载历史不等于恢复等待栈。已有 claimed 任务若没有可靠关闭证据，转 execution_unknown，并阻止后续队列执行，继续保留事件与入站记录；**尚无人工对账/解除未知的产品入口**。所有权锁只约束遵守此 managed-home 协议的本机宿主，不能防止另一个程序无视登记直接操作数据库。

生产服务器已通过 `io-server-20261012-r1` 发布 command_expires_at 元数据及后台，见[发布记录](./phase4-server-release-package-2026-10-12.md)。实验调度器仍对缺失原命令期限的来源拒绝执行；生产 managed home、真实模型和原会话闭环尚待验证，不能据服务器发布宣称电脑已可执行。

## 验证证据

`rebuild/agent-bridge/hermes/verification/managed-result.json`：11 项调度/结果防护回归及 6 项真实本机集成检查通过。真实集成使用临时 SQLite 服务和真实 HTTP 鉴权、AgentBridge outbox、AdapterHost stdio、Python 适配器、安装版 Hermes ACP/SessionManager/MCP 注册/模型工具授权与实际问题工具子进程。

模型 run_conversation 主体替换为明确的 SyntheticAgent，阻断模型进程网络，仅允许预定合成任务；临时全新测试会话明确标注 synthetic，不借用真实会话或调用办公工具。第一任务经实际 MCP 提问并保持原调用等待，第二任务持久排队；合成手机答案通过认证服务返回原调用，再产生原任务结果消息；第二任务随后执行。第三任务通过实际 ACP cancel 中断，核对取消终态。正常重启 bridge/adapter 后三个 prompt 均不重复。

独立子进程持有 managed home 锁时第二 owner 拒绝；真实硬退出后，后继 owner 可获得同一文件 inode 的锁。它证明所有权释放，**不证明崩溃任务没执行过**。另有“已返回但没有关闭证据”的组件用例，结果仍 unknown，后续任务不启动。

`rebuild/agent-bridge/verification/result.json`：61 项桥接回归通过，新增结果路由与 ACK 丢失去重、禁止结果指定其他任务/会话、取消竞争和正常退出回执测试。`question-result.json`：28 项账本/工具回归及 9 项真实 MCP stdio 检查通过。各报告含源码哈希和范围；测试数量不作为 PRD 验收或百分比。

复跑入口：准备好的 Python `-I -S -B tools/phase1/verify-hermes-managed.py`（内含 Node22 及安装目录默认值）；独立集成入口 `node tools/phase1/verify-hermes-runtime.mjs --python <准备好的Python> --source <固定安装源码> --site-packages <同环境依赖>`。测试用私有临时目录正常清理，未接生产凭据。

## 下一步及未完成

1. 为独立生产 managed home 完成显式登记、受限模型/工具配置与已有 ACP 会话创建流程，验证真实模型通过 ask/wait 继续原任务。CLI/TUI 会话不能偷换为 ACP 历史重载。
2. 准备并审核服务器多文件包及回退，部署 command_expires_at 与只读管理后台；旧 store-only 授权不自动扩展。现有网站及数据库边界继续保持。
3. P43 手机文字任务和待答入口接同一契约，补真实云端队列往返；先完成文字闭环，再接眼镜。
4. P44 补执行未知的人工对账、owner 在提问/答后执行中硬退出、取消与离线的竞争、期限与容量/保留策略、跨 OS 权限与长时间稳定性。缺失会话等准备失败目前可能保守落未知，需增加可证明未开工的错误分类。
5. 本批不关闭 AC-ASK、AC-VOICE、AC-OFF 或官方基础体验验收；不以模型替身和本机集成冒充真机端到端。
