# 现有 Agent 会话控制

本目录按已批准的[实施计划](../../../docs/product/DEFAULT-AGENT-CONTROL-PLAN.md)开发。新增官方 Codex 共享 app-server 适配器、[Claude 原会话 Mod](./claude-mod/README.md)与耐久控制器；已开始真实引擎隔离验证。尚未接手机任务分派或眼镜主动入口。旧私有 Desktop 适配器的输入仍禁用，不能把新共享服务器的成功称为任意现有 Desktop 聊天已可热接管。

`codex-desktop.mjs` 通过已运行桌面的本机 Unix socket 找到原会话持有者，沿用其模型、工作目录和权限。不会另起 app-server、resume 同一会话、接管所有权或代答审批。私有协议只接受 `codex-desktop-profile.json` 核验过的安装源码；桌面更新后须重新核对，未知版本明确拒绝。

首次快照之后只保留会话/轮次元信息，接收连续修订补丁；旧对话正文、图片和工具输出不进入状态结果。监听断开、修订缺失或结构变化后，缓存不能用于执行。内部协议仍需接收一次完整快照，最大 256 MiB；超限拒绝。本批对当前长对话的实际只读验证得到 59 个已加载轮次、约 18 KiB 保留元信息，不等于实际控制验收。

从真实 Codex 对话运行只读检查：

```sh
node tools/collab/probe-codex-desktop.mjs
```

定向测试使用独立本机 Unix socket 和模拟桌面持有者，不会向真实对话发送输入：

```sh
node --test rebuild/agent-bridge/tests/codex-desktop.test.mjs rebuild/agent-bridge/tests/session-control.test.mjs
```

`start()` 始终拒绝，`atomic_idle_start:false`，没有 bypass 开关。一次或多次本地空闲检查无法防止桌面用户同时启动任务；`useUserMessageAdmission:true` 也可能 steer，整数组替换队列则可能覆盖用户并发添加的待办。已安装 CLI 有 `thread/queue/add`，但原持有者的安全可调用入口仍待接通。[具体证据](./codex-desktop-source-review-2026-10-25.md)。

`session-control.mjs` 复用现有 BridgeState 的 fsync/原子替换和 BridgeRunLock 的进程锁，固定服务器、账号、电脑、Agent、项目、session 与工作目录。新任务先入耐久队列；只有宿主明确支持原子空闲准入或原生追加队列时才可能发送，普通新输入不会 steer 当前任务。不同文件也不能取得同一原生 session 的第二个执行锁。发送前保存操作 ID；回执丢失或进程死亡后只查原操作，部分历史没找到仍是不明，不重发。确定未发的排队命令可取消/过期；已发送的操作到期仍须核对。继续指示限有停止证据的原任务、原会话，未发的继续指示取消/过期后可重新填写。

控制器尚未接 AgentBridge/服务器控制事件，也没有生产 CLI 入口。测试用合成宿主，包括真实子进程 SIGKILL 后恢复；不能据此认为真实 Agent 执行成功。支持精确轮次的最终文字结果。声明 `final_result_evidence` 的宿主在终态之后仍须提供 `resultComplete:true`，缺最终结果时保留 `result_pending`、继续占用本会话队列，并只回查原操作；不生成第二轮补结果。未知结构不作为结果，明确空文本保留。电脑获得结果不等于手机已收到。

`interrupt(expectedTurnId)` 只向原持有者提交精确轮次的停止请求；原轮次不再活跃时不会发送。返回 `requested` 只代表宿主回执，`confirmedStopped` 始终为 false。控制器必须随后取得该轮次终态和受控子任务退出证据，才能显示 `stopped`；目前真实宿主没有后者，继续操作不会提前放行。停止回执不明也不自动重发。通用停止证据尚未接好；隔离脚本单个已知 PID 的退出证据不能直接提升生产宿主的 `descendantsStopped`。

Claude 已实现官方 Mod 候选，临时加载在真实2.1.308引擎的同一个 session 内；以后台 listener、`$.prompt.submit` 和精确 turn abort 工作。没有全局安装、修改模型供应商或接管当前用户聊天。原 Desktop 界面的加载和用户 Stop gate 仍须单独验收，早期[调查笔记](./claude-desktop-investigation.md)保留历史。


## 官方共享 app-server 候选

`codex-app-server.mjs` 只连接显式给定、已运行的服务器与已加载的具体 thread，核对原工作目录及直接输入能力。它不创建服务器、不 resume、不更换模型或审批设置；由原持有者提供连接。Unix socket 必须是当前用户的私有目录内真实 socket，官方发布的符号链接由调用方先核对并取 canonical path。

```js
const host = await CodexAppServerSession.connect(nativeThreadId, {
  endpoint: canonicalUnixEndpoint,
  workspace: originalWorkspace
});
```

`start` 调用 `thread/queue/add`，固定 UUID 消息标识；按原生 userMessage.clientId 对账，排队项尚无 turnId，不捏造轮次。`startQueued` 只显式启动本实例已记录的原 queueId，原生拒绝忙碌，不以 turn/start 替代。中断后 `terminateTurnTerminals` 仅操作原终态 turn 的命令：历史或实时原生 item/started/completed 提供 item/process 关联，再与当前 backgroundTerminals 双重匹配；代码模式子工具可能不出现在历史重建结果中。停止意图只发一次，未知不重发；回执保留来源，仍不把 terminated:true 当作所有派生进程退出。

真实安装的 alpha 声明了分页 item API，但实际返回“不支持”；适配器仅对精确原生错误回退到同一 thread/read。新空 thread 的 not materialized 也仅在载入、空闲且确无历史时接受，通用失败不解释为空历史。

两个候选都声明 `native_queue_expiry:false`：本地未发任务和调用 native submit 前可检查期限，但原生队列中等待的输入目前不能保证执行时仍有效，也未提供已入原生队列任务的产品取消。不能将其包装成严格截止或完整手机控制能力。

## 有界真实验证

两个入口必须显式 `--live`，只创建本轮隔离 session/workspace，固定合成脚本和最大运行时间；不会发送到用户正在工作的聊天。使用现有模型配置与登录，独立限制测试工具；结束后清理自己启动的进程和临时插件，Codex 测试 thread 归档。失败收尾不计为原生停止成功。

```sh
node tools/collab/verify-codex-session.mjs --live --report /tmp/codex-proof.json
node tools/collab/verify-codex-session.mjs --live --interrupt-early yes --report /tmp/codex-early-proof.json
node tools/collab/verify-claude-mod.mjs --live --claude /absolute/path/to/claude --report /tmp/claude-proof.json
```

私有 report 可带合成 nonce、临时路径和诊断，不能上传真实历史或令牌。仓库证据只保留必要的合成会话标识、检查与版本摘要。Node 定向测试使用模拟宿主/真实本机 IPC，必须与这类真实引擎证据分开。
