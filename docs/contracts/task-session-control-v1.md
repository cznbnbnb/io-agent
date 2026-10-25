# 原会话任务停止与继续 v1

日期：2026-10-25。服务端候选实现，尚未部署。此合同把手机的停止意图、电脑的实际停止证明，以及原任务的继续指示分开；不复用 `cancel_requested/cancelled`。

已认证 `GET /v1/identity` 必须声明 `task_session_control_v1`，客户端才可发布扩展字段。沿用 [1.0 事件 Schema](./event-v1.schema.json)、`POST /v1/tasks`、`GET /v1/tasks/{id}` 和 inbox 修订流，无新增控制端点。旧服务的严格 Schema 不认识这些字段，不能据客户端代码存在就发送到未声明能力的服务器。

## 字段与身份

任务新建仍是 `revision:1,state:queued`，禁止携带 `execution` 或 `control`。后续是完整任务修订，保持原 `task_id`、四项 route、`command` 和 `allow_create_session:false`。继续指示只放在 `control.text`，不改最初指令。

电脑发布的执行目标示例：

```json
{
  "execution": {
    "command_id": "10000000-0000-4000-8000-000000000001",
    "turn_id": "native-turn-1",
    "phase": "running"
  }
}
```

`command_id` 是耐久 SessionControl 命令 UUID，不能使用“当前最新命令”的临时别名。`turn_id` 在原生宿主尚未给出轮次时是 null，运行后必须是已证明的精确 ID（1–160 字符）。同一命令只允许 null 绑定为一个非空 ID，之后不能改成其它 ID 或清空。命令 UUID 在该 owner 的任务历史中唯一。

手机停止请求示例（`execution` 须逐字段保持当前服务器值）：

```json
{
  "state": "stop_requested",
  "control": {
    "control_id": "20000000-0000-4000-8000-000000000001",
    "kind": "stop",
    "expected_command_id": "10000000-0000-4000-8000-000000000001",
    "expected_turn_id": "native-turn-1",
    "expires_at": "2026-10-25T12:01:00.000Z"
  }
}
```

继续使用新的 `control_id`、`kind:resume`，增加非空 `text`，并指向已经停止的 command/turn。`text` 最多 32768 UTF-8 字节；Schema 另限 32768 字符。停止不得携带 `text`。控制 ID 不得复用历史 control 或 command UUID，所有示例 UUID 仅为合成数据。

| 身份权限 | 允许的变化 |
| --- | --- |
| `tasks:write` | 新建无扩展字段的 queued 任务 |
| `tasks:update` | 依照当前精确执行目标请求 stop/resume；原样保留 execution |
| `tasks:update` + `receipts:agent` | 在允许的状态链上发布 execution、停止证据及后续状态；原样保留当前 control |

服务端由 Bearer 推导 owner 和 scope，不信任事件自称的身份。新增字段、已有字段被删除及新停止状态都会触发扩展约束，不能删掉字段降级绕过。旧任务从未使用扩展字段时，原 `tasks:update` 状态更新规则继续兼容；它们无法直接停止或继续，须先由有 `receipts:agent` 的电脑发布实际执行绑定。原指令和 route 不可变规则同时适用于旧任务。

## 状态和执行阶段

`state` 是手机可见任务状态，`execution.phase` 保留电脑耐久控制器的细分状态。服务器要求以下对应关系：

| task.state | execution.phase |
| --- | --- |
| queued | 不允许 execution/control |
| agent_received | queued、sending、accepted；turn_id 必须为 null |
| running | running、result_pending |
| waiting_answer | running |
| execution_unknown | outcome_unknown |
| stop_requested | running、stop_requested |
| stop_unconfirmed | stop_unconfirmed、outcome_unknown |
| stopped、resume_requested | stopped |
| completed、failed、cancelled、expired | 各自同名阶段 |
| cancel_requested | queued、sending、accepted、running、result_pending、outcome_unknown；保持旧取消路径 |

running/result_pending/stop_requested/stop_unconfirmed/stopped/completed 阶段必须带精确 turn_id。其它阶段可以尚未获得 turn_id，但一旦曾有非空值不得清空。电脑可在非终态内发布同状态的新修订，用来更新阶段；手机不能借此伪造执行回执。

停止链：

1. 手机刷新任务，仅在 `running/waiting_answer` 且 execution.phase 为 running 时请求停止，command/turn 必须精确匹配。
2. 服务器保存 `stop_requested` 只代表意图已入库。电脑以 control_id 耐久去重，精确中断该原生 turn；发送结果不明只能回查原轮次，不能换 UUID 重发或选最新轮次。
3. 电脑未取得全部必要停止证据时发布 `stop_unconfirmed`。只有精确轮次终态与已覆盖的子任务停止证明都满足控制器合同，电脑才发布 `stopped`。服务器只认证证明发布者及一致性，不能独立观察电脑 OS 进程。
4. 任务在停止前自然完成可以发布 completed；失败可以发布 failed。已过期且电脑明确确认尚未执行的 stop 可回到 running；在控制仍有效时不可这样撤销。停止不明不得当作已停或允许继续。

继续链：

1. 手机只能从 stopped 请求 `resume_requested`，保留旧 execution，并携带针对该 command/turn 的新 resume control。
2. 电脑受理后发布 agent_received，新的 execution.command_id **固定为 resume.control_id**，turn_id 为 null。旧 control 完整保留，其中 expected_* 仍指向前一个真实停点；task、route 和原 command 不变。
3. 新命令取得原生轮次后发布 running；只绑定新的真实 turn 一次。之后可对这个新 command/turn 发起下一次停止。
4. resume 尚未派发便失败或过期时，电脑可以返回原 stopped（仍保留原 execution/control），手机随后可填写新 control。已经派发但结果不明必须先对账，不能重复继续。

本批限制：上面的返回 stopped 仅限仍为 resume_requested、尚未发布新 execution 的阶段。已经发布 agent_received 和新 command_id 后，即使新命令只在电脑本地 queued 时过期，服务器也会以 expired 关闭任务；暂不提供退回前一个停止点并再次继续的例外，不能隐瞒为仍可继续。

stop_requested/stop_unconfirmed/stopped/resume_requested 会拒绝旧问题答案；`reconcileRequest` 撤回仍待答的旧问题，防止从问答通道绕过停止。之前已接受的答案、历史回执和原始内容不被改写。新继续只认 control.text。

## 期限、重试与竞争

新 control 的 expires_at 必须晚于服务器当前时间，且不得晚于本次事件 expires_at。电脑执行前也必须检查，不能用后续状态事件的投递期限延长控制权限。当前原生宿主队列尚不保证执行时截止，见 [会话宿主边界](../../rebuild/agent-bridge/hosts/README.md)；服务端入库不等于宿主已执行。

已经发出停止后的事实允许晚到：后续新状态事件仍须有效，但完整保留的旧 control 即使已过期，也不能阻止电脑回传停止证明。服务器不会因期限到自动宣称停止，也不主动重新执行控制。

同事件重试保留 event_id、idempotency_key 和全部内容；原记录返回 200，不再增加修订。不同控制竞争同 revision 时仅一个事务成功，其余得到 REVISION_CONFLICT。读取新版本后不能把旧 UUID 自动改成新执行目标。控制和执行历史随 SQLite 事务保存，重启不丢幂等记录。

| 错误 | 含义 |
| --- | --- |
| 403 FORBIDDEN | 缺 scope；手机尝试修改电脑证明 |
| 409 REVISION_CONFLICT | 任务已有新修订，先刷新 |
| 409 ROUTE_MISMATCH / TASK_COMMAND_IMMUTABLE | 改了原 route、指令或创建会话许可 |
| 409 TASK_CONTROL_STALE | command/turn 或可控制状态不再匹配 |
| 409 TASK_CONTROL_INVALID / TASK_EXECUTION_INVALID | 字段、状态、阶段组合无效或试图删除受保护字段 |
| 409 TASK_EXECUTION_REBIND | 替换已绑定的命令或原生轮次 |
| 409 TASK_CONTROL_ID_CONFLICT / TASK_EXECUTION_ID_CONFLICT | 复用历史标识 |
| 409 TASK_CONTROL_PENDING | 有效 stop 尚待处理，不能宣称恢复运行 |
| 410 CONTROL_EXPIRED | 新控制已过期，未受理 |
| 400 TASK_CONTROL_DEADLINE_INVALID / TASK_CONTROL_TEXT_INVALID | 期限超出事件窗口，或继续指示超出字节限制 |

## 验证范围

`rebuild/material-server/tests/task-session-control.test.mjs` 使用合成身份、临时 SQLite 和真实 loopback HTTP，验证完整 stop→stopped→resume、状态与身份保护、轮次绑定、期限、UTF-8 限制、双请求 CAS、幂等重启、旧任务兼容与旧问答收口。原 queue/request-lifecycle 回归保留。此证据不替代原生 Agent、手机 UI、眼镜或线上部署验收。
