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
