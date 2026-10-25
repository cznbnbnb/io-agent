# Claude 原会话接入调查

日期：2026-10-25。范围：Claude Desktop Code 与交互式 Claude Code CLI。只读调查；未修改 Claude 安装、配置或凭据，未启动新会话、向已有会话发送输入、打断任务或启用 Remote Control。

## 后续调研纠正（2026-10-25）

原会话控制在本项目仍未接通，但下方“没有公开接入候选”的结论已过时。用户提出 listener/hook 后，核对到官方 [Mods](https://code.claude.com/docs/en/plugins/mods/overview) 支持 Desktop 原进程扩展（最低2.1.286，本机内嵌2.1.308满足）。后台任务可用 [prompt.submit](https://code.claude.com/docs/en/plugins/mods/api) 等待空闲后启动原会话轮次；[reference](https://code.claude.com/docs/en/plugins/mods/reference) 有 session ID、精确 turnId abort 和生命周期。重新加载 Mod 可以初始化监听，无需把原 Desktop 改成新 CLI 会话。

本机内嵌二进制静态核对：`$.session.id()` 读取当前 ID；abort 同步拒绝不存在、不匹配或已结束的 turn；submit 先检查用户 Stop 限制，再处理归因。用户 Stop 后不得用后台任务绕过；/clear、/resume、/branch 触发 session.end，须解绑旧监听。仅文档和静态代码，未安装/调用；下方旧 Desktop manager 无 expectedTurnId 的发现不适用于这个新增 Mods 入口。

补核停止后继续：2.1.308内嵌引擎中，Mod `turn.abort` → `r.cancel()` → 已登记的 abort；交互式与SDK路径分别在字节253863107、255176640调用 `AbortController.abort("turn-abort")`，未调用用户 Stop 入口使用的 `GKt()`。由此推断 Mod 停止后可以等待终态再 submit；若用户也点了 Stop，仍须尊重拒绝后台工作的状态。此处为静态推断，真实轮次、待发输入和子进程退出须独立验收。

[asyncRewake](https://code.claude.com/docs/en/hooks) 也是可唤醒空闲会话的官方 hook，不能把普通 Stop/async 的限制泛化到全部 hook。优先验证 Mods 的完整输入、停止、生命周期，再考虑 Channels/asyncRewake。详细比较与来源见[计划调研节](../../../docs/product/DEFAULT-AGENT-CONTROL-PLAN.md#2026-10-25-远程会话唤醒调研)。本轮未修改安装、设置、凭据或运行中的任何会话。

## 早先产品结论（保留调查历史，以以上纠正为准）

**Claude Desktop 原会话控制暂不可用。** 已证实 Desktop 自身具备发送、停止与会话管理方法，但本次没有找到可供外部桥接使用、保留真实调用者身份和权限检查的公开接口。手机应明确显示该能力未接入；不能把“已登记连接”“眼镜问答可返回”当成“手机可以主动下发或打断”。

当前可推进 Codex 的元信息与耐久控制基础；Codex 输入同样仍待安全的原子准入入口。Claude 接入按下面两个有限出口处理，不以继续遍历私有接口作为无期限前置：

1. **保留 Desktop 原会话**：Mac 解锁且隔离测试聊天获授权后，验证原生 UI 与官方 Remote Control 的原会话行为。这能验证官方控制通路，不能直接作为自有 App 已接入的证据；只有进一步获得明确支持的外部入口后才开放产品能力。
2. **交互式 CLI 受控桥接候选**：另行设计一次明确的会话接入，使用官方 Channels 的交互式启用及许可流程，先验证精确会话绑定、去重、回执与结果。硬打断需独立证明，Channels 收到事件不代表已停止。若必须创建或重新启动进程，须明确作为新的或重新接入的会话；不能新起 `resume` 进程后冒充原 Desktop 持有者。

第二条是候选产品路径，并未实现或通过真实验收。用户若坚持仅控制现有 Desktop 原会话，应保持不可用状态，等待可支持的宿主入口，不静默改用另一会话。

## 本地可复查证据

安装包：`/Applications/Claude.app/Contents/Resources/app.asar`。以下文件均位于包内 `.vite/build/`；位置为 UTF-8 解码后字符串的零起始字符偏移，适用于本次安装，更新后必须重新核对。摘录只检查代码结构，没有读取会话正文或凭据。

| 文件与位置 | 观察 | 对接含义 |
| --- | --- | --- |
| `index.chunk-DVWJXMwL.js`：44944 附近 | `LocalSessions.sendMessage` 转发到原 manager | Desktop 内部有发送能力；未发现外部控制传输入口 |
| 同文件：49890 附近 | `LocalSessions.interrupt` 调用 `manager.interruptSession` | 内部方法存在不等于外部调用者可用 |
| `index.chunk-DNPOm2Zc.js`：606938 | `async interruptSession(sessionId, origin="user")` | 无 Codex 式 `expectedTurnId` 参数；尚未证明原子停止指定轮次 |
| `index.chunk-DBIg6EBr.js`：206249 起的相邻注册代码 | 内部会话工具绑定真实 caller，以 `sessionInReachOf(callerSessionId, target)` 判定范围 | 不得构造虚假的 caller context 调用 |
| 同文件：226201 附近 | `stop_session` 使用 `interruptSession(target,"agent")`；保护等待用户回答和用户待发输入，并区分 queued/skipped | 接收停止请求不能当作实际停止；不能丢弃用户输入 |
| 同文件：458900 附近 | MCP 工具调用经过 `authorize` gate | 不能绕过内部审批、信任与权限判定 |
| `index.chunk-BntufAG5.js`：3402 附近；`index.chunk-9KNsSZi-.js`：18172 附近 | 本地 socket 分别用于 browser-env bridge、SSH askpass，具备各自的专用凭据检查 | 均不是会话控制 API，不复用或读取其凭据 |

本次核对源码 SHA-256：

- `index.chunk-DVWJXMwL.js`：`08514102edb2f37953613c8deb8da8247a5954c4178aa06224a40f4e18cace88`
- `index.chunk-DNPOm2Zc.js`：`6b27cd273bedd283c531bf6770e4cd6e576bbeece0e0b92dbc0b0705099c3379`

## 官方支持边界

- [Remote Control](https://code.claude.com/docs/en/remote-control)：支持在现有 Desktop Code 会话执行 `/remote-control`，经首次确认后从同账号官方客户端访问原会话。该通路走 Anthropic 服务并同步会话；本次文档没有提供第三方程序控制 API。不得把启用它直接视为自有 App 接入，也不默认开启所有会话。
- [Channels reference](https://code.claude.com/docs/en/channels-reference)：支持本地 MCP 通过 `notifications/claude/channel` 向已选择的交互式 CLI 会话发送事件。自定义开发 channel 需要 `--dangerously-load-development-channels` 与本地确认；文档明确该参数在 `-p` 或 Agent SDK 下被忽略。未给出硬打断协议。仅添加 MCP 配置不能证明当前 Desktop SDK 会话支持注入。

这些是文档支持范围及本次调查结论，不是对尚未测试配置的可用性保证。不采集 Claude 账号令牌、不冒充 Claude peer、不修改安装包或原审批策略。

## 待满足的实际前置

- **Mac 解锁**：现有 UI 工具报告屏幕锁定且自动解锁失败，已询问用户；尚未收到解锁确认，不绕过锁定读写 UI。
- **临时原生测试聊天授权**：已询问是否允许新建 Codex、Claude 各一个可丢弃测试聊天；尚未收到答复。新建工具要求明确授权，不能拿当前工作会话替代隔离测试。
- 本笔记不关闭人工验收项；原会话的实际下发、打断、继续及手机结果回显均未验收。
