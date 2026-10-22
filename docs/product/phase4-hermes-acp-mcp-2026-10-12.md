# P42 原生 ACP/MCP 接线与进程清理（2026-10-12）

本批起点 `f95535a`，开始时工作区干净。继续把运行时账本/提问工具接到安装版 Hermes，未改用户 Hermes home、原会话、手机、线上服务或 Excel。**这是实际协议与原生工具调度的组件联调，不是真实模型或正式业务端到端验收。**

## 已验证的链路

官方 ACP SDK stdio → 原生 Hermes load_session/MCP 注册 → 原生 Agent 工具授权表 → model_tools.handle_function_call → 原生 MCP stdio 子进程 → 本项目持久问题/事件 → 合成测试端保存原路由答案 → 原生工具等待返回 → 同一次合成 run_conversation 继续 → 原 ACP session 数据库保存答后结果。

使用固定安装源码 `08165d58931841cee713468ae89032af7c57060a`、准备好的 Python 3.14.7，源码只读。实际运行 Hermes 的 ACP handler、SessionManager、SessionDB、MCP discovery/registry 和模型工具调度；**只将模型会话主体替换为合成代码，答案也由测试端提供，未使用认证服务器。**

两个配置各 9 项检查通过：

| 配置 | 实际调度 | 结果 |
| --- | --- | --- |
| 默认 tool_search | 授权目录中有两个 MCP 工具；模型表通过原生 tool_call 间接调度 | 提问、同一调用等待、答案返回并继续均通过 |
| 隔离配置 tool_search off | 模型表直接暴露两个 MCP 工具 | 同样通过，不需要修改用户配置 |

两条路径都实际读取问题账本，确认 prompt 尚在运行后再写答案；答后检查 request/runtime_request/answer ID 一致、合成 prompt 计数恰为 1，并读取原 session 的数据库确认只有一条用户提示和答后助手结果。没有通过第二次 prompt 或 auto-continue 重新发起问题。

### 接入时不能省略的判断

- ACP 加载成功不代表 MCP 注册成功；原生 handler 会捕获注册/刷新异常。
- MCP registry 有工具也不代表模型表直接有同名工具。默认工具搜索会将 MCP 工具收进 tool_call；须检查**该 session 的未折叠授权目录及实际可用调度路径**，不能扫全局 registry 当授权。
- 本批调用保留原生 handle_function_call 的 scope 校验、hooks 和 middleware；没有直接调全局工具来绕过 session grant。
- 最初网络封锁拦住 Windows 事件循环的本地唤醒连接；测试在封锁前预建 ACP 及 Hermes MCP 的两个本地循环，后续仍阻断外部网络。这个修正只在隔离探针中，不改生产权限。
- ACP end_turn 仍返回 task_completed=false/completion_verified=false。测试会话继续不是正式任务完成，更不是原 owner 重启后的旧等待栈恢复。

## 实际代码：Windows 子孙进程保护

新增 `process_job.py`，使用系统 Job Object 的 KILL_ON_JOB_CLOSE；不允许 breakaway、不让子进程继承 Job 句柄。

ACP 传输新增可选 process_job：SDK 创建 ACP 子进程后，在 initialize/load/prompt 前归入该 Job；归入失败就停止，不继续加载工具。绑定使用本次 Popen 持有的进程句柄副本，不按 PID 重新打开，避免退出/PID 复用误伤其他进程；asyncio.Process 读取其底层 Popen（本机 Python 3.14 实测，其他运行时须重验）。

正常关闭先结束 SDK 连接，再终止并查询 Job 的 active_processes，确认归零后才关闭句柄；确认失败保留传输所有权并报 ACP_STOP_FAILED。未启动即关闭也清理已创建的 Job。Job 仅属于本次创建的运行时子进程，禁止传其他应用/Agent 进程。

实际验证包含：

- 本次 ACP owner 和真实 MCP 工具子进程同时归属于同一 Job；结束后 leader 已退出、Job 句柄已释放。
- 独立测试 owner 在子进程被归入 Job 后才允许其创建孙进程；外部测试端保留两个进程的内核句柄，确认原本运行，再令 owner 以 os._exit(73) 硬退出；两个原进程句柄均变为退出态。没有用 PID 消失替代证明。
- 显式 shutdown 确认归零；未知对象/仅带 pid 的对象/已关闭 Job 均拒绝归入。3 项实际 Windows 测试通过。
- 传输防护现为 14 项，另有原 ACP stdio 10 项通过，覆盖归入先于 initialize、归入失败清理、子孙退出未确认保留所有权及启动前释放。

这**不是全局 Hermes 会话所有权锁**。不能据此接管另一宿主的已有用户 ACP/CLI/TUI 会话，也不提供任意 launcher 在归入前派生子进程的原子隔离保证。后续 managed runtime 需要独占 home/session 登记、启动入口约束和进程树保护共同工作；Job 也不能撤销已发生的外部操作。

## 证据与复跑

- [联调与进程树汇总](../../rebuild/agent-bridge/hermes/verification/acp-question-result.json)
- [默认工具搜索明细](../../rebuild/phase1/hermes-acp-question-default-probe-2026-10-12.json)
- [直接工具表明细](../../rebuild/phase1/hermes-acp-question-off-probe-2026-10-12.json)
- [传输回归](../../rebuild/agent-bridge/hermes/verification/result.json)

入口：`tools/phase1/verify-hermes-acp-questions.py --source <安装源码> --site-packages <准备环境依赖>`；使用该环境 Python 加 `-I -S -B`。生成的私有 home 位于被忽略的 rebuild/phase1/runtime-home，正常实验结束后清理。不要在真实用户 home 运行合成实验。

## 下一项代码交付

将桥接协议 item/answer/closed/events/ACK 与同一运行时账本接线，网络收信和模型执行分开；先实现明确的 managed home/session 所有权及忙时持久队列，再引入原生执行完成事实。必须保留 claimed 不明结果，不能因 Job 已清理就重新执行。真实模型、认证服务器、手机与眼镜闭环、原 owner 重启恢复、取消确认和长期稳定性仍需各自证据，P42/AC-ASK 尚未关闭。

本批结束时生产服务端补丁尚未部署，未重试或变更生产。后续用户于 2026-10-12 明确授权，该单文件补丁已发布，详见[发布记录](./server-store-release-2026-10-12.md)；这不改变本批 Hermes 联调仍为组件验证的结论。
