# Codex 原会话适配复核（2026-10-25）

本次只读核对已安装桌面源码，并在独立合成 Unix socket 上测试；没有向真实会话提交输入、停止、继续或队列变更，没有读取用户会话正文、凭据或操作手机。此前真实当前会话的只读证据仍见 `codex-desktop-proof-2026-10-25.json`，不扩大其验收范围。

## 当前能力与明确限制

- `atomic_idle_start: false`：`start()` 始终返回 `CODEX_DESKTOP_IDLE_ADMISSION_UNVERIFIED`，不会发送输入，也没有绕过开关。上层可以保存待办并显示等待能力接通，不能声称任务已经交给原会话。
- `exact_turn_interrupt: true`：保留已核对的原持有者 + `expectedTurnId` 停止请求。宿主回执仍只表示请求受理，`confirmedStopped` 始终为 false；不将其当成进程或子任务退出证明。
- `validateStartReceipt()` 仅为纯校验函数，供将来已验证的原子准入通道使用，不开放输入。缺少原生 turn ID、非法 ID 或未知 turn 状态均返回 `outcomeUnknown: true`。

## 为什么不能直接开放 start

已安装 `/Applications/ChatGPT.app/Contents/Resources/app.asar` 的 `.vite/build/src-CsH31EEu.js`（1,664,092 字节；SHA-256 `6a266611954c6f0c72aca09bb13c0c793959a69e8d6330778a7cdef21835a1db`）：

| 源码位置（JS 字符偏移） | 核对结果 |
| --- | --- |
| 531210，`thread-follower-start-turn` | 直接调用原 manager 的 `startTurn()`，不是原子“空闲才开始”接口。 |
| 839314，`aj()`；839473，`oj()` | `useUserMessageAdmission: true` 在普通用户会话上选择 `turn/addUserMessage`，回执包含 `started`、`steered`、`duplicate`。`steered` 会把输入作为当前 turn 的 steering 消息，不能用它替代“忙时排队”。 |
| 871000–878500，`eM()` | `false` 选择 `turn/start`。仅 app context 和 environment recovery 有特别的空闲条件；普通输入没有 owner 端 idle-only fence。 |
| 939900–942600，提交协调器 | `when-idle` 和 `send-now` 是不同语义；不能通过桥接本地串行锁消除桌面用户在检查之后发送新输入的竞态。 |
| 528819、967808，`acceptFromFollower()` | `thread-follower-set-queued-follow-ups-state` 接收完整队列并替换普通条目，只特别保留未明确丢弃的 outcome-unknown 条目。没有预期 revision / CAS，不能用“先读后补一个条目”假设无损追加，可能覆盖用户并发添加的待办。 |

作为交叉核对，[OpenAI 当前公开 `turn_processor.rs`](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/request_processors/turn_processor.rs#L624) 的 `turn/start` 调用 `start_or_steer_turn`，并接受 `Steered` 结果。因此不能假设公开 start 方法在忙碌时必定拒绝。

上述公开 main 分支不是已安装 `0.163.0-alpha.11.1` 的精确 Rust 构建来源。安装二进制中可以找到 `NotIdle`、`start-if-idle` 和 `steer-only` 等字符串，但单凭字符串存在不能证明某个 API 的语义。随后已用本机二进制生成 schema，确认本安装版的 `turn/start` 也允许 steer，证据如下。

执行 `/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex app-server generate-json-schema --experimental --out <临时目录>`，版本输出为 `codex-cli 0.163.0-alpha.11.1`。这只生成协议 schema，没有启动服务；读取后已删除临时目录。

- `TurnStartParams.json` 的 SHA-256 为 `abf0d6d29d223b38c650ff1155cb9c9f9b4211e6d0e20c57d750a9e1babfdb41`。其中 `turnTrigger.description` 明确写明：`Ignored when this request steers an already-active turn.` `parentTurnId` / `rootTurnId` 同样说明请求可以向 active turn 添加输入；`serviceTierForTurn` 区分新建 turn 与被 steer 的 turn。这是本机安装版直接生成的证据，不依赖对公开 main 的版本推断。
- `ThreadQueueAddParams.json` 的 SHA-256 为 `60f25b7d3e3357c215bef9d2fe7047200f545e030dca9e00527ac0620cd0c88f`，必填字段只有 `threadId`、`input`、`clientUserMessageId`。本机协议已有 `thread/queue/add` 追加入口；但当前核对的桌面 follower IPC 没有透传任意 app-server 请求的入口，不能直接把它当成已接通的原 owner 队列能力。

本次没有启动另一个 app-server 或向运行中的真实 turn 注入探测。真正接通前仍须找到并验证原持有者提供的原子 idle-only / 无损追加接口，或采用原厂明确支持的同等入口。

## 有界追加核对：responseItems 不能作为空闲锁

再次只读检查同一已安装 src 模块的 869000–878650，结论仍是不能开放输入：

1. `Qj()` 仅对没有实际输入、设置和非空 context 的特殊空请求复用 `turnStarts`；有输入或 `responseItems` 时直接进入 `$j()`。这个 Map 是空请求合并，不是所有桌面 / IPC 输入共享的会话互斥锁。
2. `eM()` 在 `P.prepare()` 之后计算 `te`，发现已有活跃 turn 就拒绝带 `responseItems` 的请求。随后创建自己的待开始占位 turn，再计算 `c`，核对占位 turn、client message ID 和 runtime 状态。
3. `c` 检查通过后仍要 `await e.sendRequest('thread/inject_items', ...)`。返回后只清理未确认请求、运行 `O_(state)` 及可选 `S()`，没有重新计算 `c` 或向 `turn/start` 携带“仍为空闲”的原子条件。
4. 另一条合法的直接 follower 输入或桌面显式立即发送可以在该 `await` 期间启动新 turn；后续 `turn/start` 仍具有已由本机 schema 确认的 steer 语义。原厂默认排队策略减少部分交错，并不证明所有入口共享同一原子准入。

因此两次检查、设置本地占位状态及 inject completion 都不能形成原子保护。`responseItems` 本身还会注入实际会话内容，不应伪造一个 context 条目充当锁。本次没有创建或发送任何这样的条目，也没有发真实输入或停止请求。

对队列入口只作定点复核：1051974 的原厂 server queue controller 确实调用 `e.sendRequest('thread/queue/add', ...)`；1593450–1594900 的 `T0()` 列出当前 owner follower IPC handlers，没有 queue append 或通用 app-server 请求代理。现有 queue handler 仍只有完整状态替换、删除一条、清空队列。完整替换缺少 CAS，不能安全模拟 append。结论限于已核对的当前 owner follower 接口；尚未找到可由项目适配器正常调用的无损追加入口，保持 `atomic_idle_start: false`。

## 有界追加核对：在 start request 中传 mode: queue 不会接通队列

继续追踪原厂真实的 queue mode，未发送任何请求：

- `.vite/build/src-CSKkIr_z.js`（207,355 字节，SHA-256 `4a939ae29c4f4010a62a7890797813363d4d2300afb43df4101872246cc7f0d6`）的 `Zr()` 在 36685 将 `thread/queue/add` 映射为 `turn/addUserMessage`，并增加 `mode: 'queue'`。这是实际队列序列化分支，不能据此推断 start handler 会保留 mode。
- `src-CsH31EEu.js` 的 `qj()`（866324）确实先 spread 原 request。但原持有者随后执行 `Yj()` → `Bj()`，`Bj()` 在 **862134** 重新逐字段构造 `Re`，没有 `...c`，白名单中没有 `mode`。返回值明确为 `{request: Re, params: ze, ...}`；`ze` 虽保留原字段，却是本地 turn 参数而非发出的 request。因而 `turnStart.request.mode` 会在此消失。
- `eM()` 真正发送使用 `I.request`。本地兼容处理 `n.c` 对应 `src-CSKkIr_z.js` 的 `Zm()`（172935），该函数仅 spread request 并按版本处理 lineage 字段，本身不删 mode；但它收到的 `I.request` 已无 mode。
- `useUserMessageAdmission: true` 只选择 admission 方法，不会补回 `mode: 'queue'`。此外 admission 回执路径在 879000 后直接访问 `ce.turn.id`，`oj()` 仅识别 started / steered / duplicate，没有 queuedSubmission 分支。即使另一个未经验证的路径能传入 queue mode，也不能假设现有 start handler 能处理排队回执。

因此 `mode: 'queue'` + `useUserMessageAdmission: true` 在该原 owner start 入口不可行：字段被白名单丢弃，随后仍可能 steer 当前 turn。没有修改或伪造 context，也没有尝试绕过字段过滤；输入能力继续关闭。

## 状态投影修复

已安装 src 模块约 130618 的 `q(state)` 会合并 canonical history 与 legacy live overlay。合并函数位于 `.vite/build/conversation-turn-mutations-DZp-AgIY.js` 的 37821，53,115 字节，SHA-256 `f386be772ed58985a666ec48ded161be66cf8d3df0389f09fe622a0bbf40b170`。

原适配器只读 canonical 时会漏掉 live overlay 的新 turn 或操作 ID。本次将两者按原生 turn ID（占位 turn 用 client message ID）合并；任何来源仍为 `inProgress` 都继续视为活跃；冲突的终态或不同操作 ID 明确返回状态不确定，不猜哪一份更新。

原厂 `xp(state)`（约 256923）也把未确认提交及 resuming 纳入忙碌判断，`O_(state)`（409717）在仍有未确认提交时直接拒绝后续开始。本次投影保留 `resumeState` 与未确认条目的最小状态，终态标记但尚未清账的提交也继续阻止“空闲”误报。投影不保留其输入文本。

本次合成覆盖包括：canonical + live overlay、重叠 turn 去重、操作 ID 冲突、resuming、未确认条目的增改删、并发 start 全部不发送、残缺开始回执，以及停止请求丢回执不重试。

## 最终答复提取设计依据（尚未实现）

以下均来自同一已安装 src 模块：

1. 约 133742 的原厂会话摘要选择最后一条非空 `agentMessage`，优先 `phase === 'final_answer'`，没有时才回退到 `phase == null` 的旧格式；`commentary` 不能作为最终结果。
2. 587785 的 item started 清除该消息的 `agentMessageCompletedAtMsById[id]`；589480 的 item completed 在 flush 文本增量后记录完成时间并更新该完整 item。turn 的 `items` 中使用 `id`、`type: 'agentMessage'`、`phase`、`text`。
3. 606283 的 turn completed 先 drain 已排队的 item 增量，再写入 turn 的 `status` / `error`，最后广播会话快照。成功结果须对应确切 operation / turn 且 turn 为 `completed`；`failed` / `interrupted` 不能因为已有一段 assistant 文本就报成功。
4. 354080 的补丁接收器还处理 `acceptedTextChanges`。现有适配器有意只处理元信息，没有完成文本投影；扩展时必须核对这条文本通道，不能仅凭 `patches` 猜已取得全文。

建议结果接口按已持久化的 `clientUserMessageId` / 原生 turn ID 精确跟踪，只保留该委托的最终文字，避免将全部历史正文送入手机。不得用会话“最后一条答复”代替本操作的答复。历史未加载、回执丢失或状态流断层时继续报告不确定，不重发输入。文本可以在确认原 turn 终态的完整快照中提取，以避免仅靠 streaming delta 宣布完整；若无法获得这一快照，先保持结果待核对。

停止语义另有边界：`fx()`（约 563487）核对 `expectedTurnId`，但 `hx()` 的 node REPL 清理超时/失败仅记录警告，后代停止也会捕获警告。因此原 turn 显示 `interrupted` 仍不等于所有受控子进程已经退出；必须补独立退出证据。

## 验证

`node --test rebuild/agent-bridge/tests/codex-desktop.test.mjs`：17 / 17 通过。测试使用合成 Unix socket，没有真实输入或 unsafe override。当前仍未完成原生下发、停止/继续端到端验收、最终结果读取和手机交付。
