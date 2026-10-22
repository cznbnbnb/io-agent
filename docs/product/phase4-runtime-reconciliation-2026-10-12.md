# P44：执行不明的只读检查与明确对账

日期：2026-10-12。承接真实模型 CLI 接入与取消；本批仅电脑/本机服务器回环，未操作手机、生产服务或 Excel。此入口不自动重发原 prompt，也不恢复已丢失的工具等待栈。

## 用户可观察的变化

原生 ACP 子进程异常退出且没有可信结果时，任务转 `execution_unknown`，后续任务保留排队。管理员可以查看证据摘要，在停止该 managed runtime 后完成对账。对账结果和事件原子保存，随后连接程序按原 delivery/任务/会话上传；原任务不会重新执行。没有结论时继续保持不明，不删除 claim、改 delivery 或新建替代会话。

这里实现的是电脑侧行政 CLI，未暴露给模型工具或 skill，也未接入手机/后台管理 UI。生产身份、真实人工裁决、手机/腾讯云端到端、工具副作用与长时间稳定性仍未验收；P44 整项保持未完成。

## 修复的实际缺陷

安装版 ACP SDK 的 `Connection._receive_loop` 在 EOF 时直接结束，未将等待中的 outgoing request 设为失败；`close()` 才拒绝它们。实际测试中，所属 ACP 子进程已异常退出，但任务仍为服务器 `running`、本机 `claimed`，调度器无法进入不明与对账分支。

`acp_transport.prompt()` 现同时等待 RPC 和所属进程的退出观察。进程 `returncode` 来自 OS 的进程退出观察，不使用超时猜测死亡；不直接依赖可能等待继承管道关闭的 `Process.wait()`。进程先退出时返回 `ACP_PROMPT_OUTCOME_UNKNOWN`，取消本地挂起 RPC 等待，调度器继续确认进程树关闭并保留不明。正常存活的模型/工具等待没有新加墙钟超时。安装源码未修改。

## 检查和裁决边界

`rebuild/agent-bridge/hermes/reconcile_cli.py` 提供两个显式命令，均以 prepared Python 加 `-I -S -B` 运行：

```text
reconcile_cli.py inspect --config <现有私有runtime.json> --operation <operation_id>
reconcile_cli.py apply --config <同一私有runtime.json> --decision <私有decision.json>
```

`inspect` 使用只读 SQLite 事务，不启动模型/SDK、不取得 owner 锁、不初始化缺失库、不迁移 schema。输出 task/route、状态、取消意图、原生返回标志/关闭证据、结果 SHA、问题状态与答案是否存在，以及 `review_digest`；不输出 prompt、原文结果、答案正文、凭据或证据文件路径。当前只读支持 schema 3，旧 schema 须由正常运行时验证并迁移后再检查。

`review_digest` 覆盖绑定、原操作/来源/结果、原生证据、取消意图和问题/答案/消费状态。事件 ACK 和无关任务不使检查失效。`apply` 必须获得与执行器相同的 managed-home 独占锁，并在 SQLite 写事务中重新核对 digest；活跃 owner、错误会话、过期检查、证据变化、外来库或其他终态均拒绝。不得删除锁文件、杀其他 owner 或手工修改账本来绕过。

两种裁决方式：

| method | 可以提供的结论 | 依据与限制 |
| --- | --- | --- |
| `native_evidence` | completed / failed | 使用既有原生结果分类器，必须已有可信结果和进程树关闭证据。不能用 end_turn、结果文字、取消意图或仅 leader 退出代替；不从缺失的 ACP 取消观察推断 cancelled |
| `operator_attestation` | completed / failed / cancelled | 必须由操作者检查原任务产物/副作用与所属进程后明确提交；记录 actor、reason、证据 SHA、停止进程/检查副作用确认、原 digest、resolution_id 与决定摘要。它是人工声明，`native_completion_proven=false`，不伪装成原生执行证据 |

人工 completed 还需要操作者提供实际已核对的 result_text，并向手机结果之前附独立 progress：“任务结果经人工对账确认，未重新执行原任务。”失败/取消不生成成功产物。证据文件只读取本地普通单链接文件（1字节–16MiB），核对 SHA 后仅保存摘要；不上传证据原件或私有 reason。

**开发 Agent 不得自行编造真实人工确认、选择实际未知任务的结果或创建裁决文件来解除阻塞。** 本批所有 operator_attestation 均明确为合成测试。真实未知任务需要操作者给出确切结论与证据；没有这些条件只执行 inspect，继续其他独立开发。

## 决定文件

原生证据决定的字段固定为 `schema=1`、`operation_id`、`review_digest`（inspect 输出的64位SHA）、`resolution_id`（稳定、不可改变含义）、`method="native_evidence"`。

人工声明在这些字段上改 `method="operator_attestation"` 并增加：

```json
{
  "actor": "明确的人工操作者",
  "decision": "failed",
  "reason": "操作者对原任务实际状态的核对说明",
  "evidence_file": "本机证据文件的绝对路径",
  "evidence_sha256": "该文件的实际64位SHA256",
  "result_text": null,
  "confirmation": "I_VERIFIED_ORIGINAL_TASK_OUTCOME_AND_WILL_NOT_REPLAY",
  "owned_processes_stopped": true,
  "external_effects_reviewed": true
}
```

这段只是字段说明，不是有效决定或已确认事实。completed 的 result_text 必须为核对过的非空文字；failed/cancelled 必须为 null。未知/额外字段拒绝。不要把证据、决定、runtime 配置或用户正文提交到 Git。

## 持久化与恢复

不升级 schema：沿用 schema 3 的 operation outcome 保存 prior_outcome 和 reconciliation 审计。原 unknown 事件不修改/删除，新对账事件使用原 delivery 与独立稳定 ID；终态和事件在同一事务写入。相同决定重试返回 already_reconciled，不多发结果；改变同一裁决、复用冲突事件或更改终态拒绝并回滚。原操作保持不可再次 claim。

本地 `reconciled` 仅表示运行时账本接受，返回 `cloud_delivery_verified=false`。停止状态下服务器仍可为 execution_unknown；重新启动 bridge 后，经原持久事件/outbox 传输才形成服务器终态。后续任务在未知消除后可继续。这里没有自动恢复 bridge 自身的 DISPATCH_UNCERTAIN、待答栈或服务器冲突合并，不将这些边界归为已完成。

## 验证与剩余

复跑：prepared Python 执行 `tools/phase1/verify-hermes-reconciliation.py`。它先跑隔离账本/CLI 测试，再用真实安装版 ACP、真实 MCP 接线、本机认证 HTTP/SQLite 队列与合成模型触发实际 ACP 子进程 `os._exit(73)`；合成裁决只证明接线和幂等，不代表真实人工审核。

证据文件：

- `rebuild/agent-bridge/hermes/verification/reconciliation-result.json`、`reconciliation-tests.log`：只读不泄露正文/不改库、缺库拒绝、owner 互斥、正常/重复/陈旧/冲突与事务回滚、错误绑定/证据变动、原生证据不足、人工结果单独标识、实际 CLI。
- `rebuild/phase1/hermes-managed-reconciliation-runtime-2026-10-12.json`：实际异常退出变 unknown、后续任务不执行、owner 活跃拒绝裁决、停止后明确合成对账、正常重启经 HTTP 上传失败与下一任务结果；原任务只进入模型一次，没有成功结果。
- `rebuild/agent-bridge/hermes/verification/result.json`：ACP 传输回归及真实安装版 stdio；新增存活等待不误超时、已退出子进程解除挂起但不重试。
- `rebuild/agent-bridge/hermes/verification/journal-result.json`：原账本持久/竞争/事务回归。
- `rebuild/phase1/hermes-real-provider-cancel-2026-10-12.json`：传输改动后再跑真实模型问答/取消回归，与合成对账分开。

当前结果分别为：对账单元11项/本机完整集成9项；传输单元16项/实际安装版stdio10项；原账本16项；真实模型链路最新8项通过。新增问题撤回和实际过期等待的范围、失败记录及源码检查见[问题生命周期交付](./phase4-request-lifecycle-2026-10-12.md)。它们覆盖各自列出的边界，不代替手机、眼镜或PRD验收。

初次失败证据另存 `hermes-managed-reconciliation-attempt1-2026-10-12.json/.log`（实际 EOF 挂起缺陷）；第二次另存 attempt2（产品链已进入对账并恢复队列，验证器使用 limit=100 超过服务 max=50）。后续修复不放宽业务保护，重新建立独立合成任务验证。

下一步仍需：真实生产身份和云端出站、手机任务页启用/首答/取消、问题撤回/期限与取消竞争、bridge 自身不明投递的恢复、真实外部任务副作用取证、容量归档与8小时稳定性。官方基础对齐和 P13 设计确认门槛不变。
