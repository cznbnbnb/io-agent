# 现有 Agent 会话控制

本目录按已批准的[实施计划](../../../docs/product/DEFAULT-AGENT-CONTROL-PLAN.md)开发。目前具备 Codex 桌面元信息适配及独立耐久控制器，尚未连接手机任务分派。**真实下发仍禁用**：已发现普通开始接口会在竞态下 steer 当前任务，尚缺符合“忙时排队”的原子准入入口。Claude、实际执行/打断验收和眼镜主动入口仍未完成。

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

`session-control.mjs` 复用现有 BridgeState 的 fsync/原子替换和 BridgeRunLock 的进程锁，固定服务器、账号、电脑、Agent、项目、session 与工作目录。新任务先入耐久队列；只有宿主明确支持原子空闲准入时才可能发送。不同文件也不能取得同一原生 session 的第二个执行锁。发送前保存操作 ID；回执丢失或进程死亡后只查原操作，部分历史没找到仍是不明，不重发。确定未发的排队命令可取消/过期；已发送的操作到期仍须核对。继续指示限有停止证据的原任务、原会话，未发的继续指示取消/过期后可重新填写。

控制器尚未接 AgentBridge/服务器控制事件，也没有生产 CLI 入口。测试用合成宿主，包括真实子进程 SIGKILL 后恢复；不能据此认为真实 Agent 执行成功。暂不提取最终结果，`completed` 只表示对应原生轮次已完成，不是手机已收到结果。

`interrupt(expectedTurnId)` 只向原持有者提交精确轮次的停止请求；原轮次不再活跃时不会发送。返回 `requested` 只代表宿主回执，`confirmedStopped` 始终为 false。控制器必须随后取得该轮次终态和受控子任务退出证据，才能显示 `stopped`；目前真实宿主没有后者，继续操作不会提前放行。停止回执不明也不自动重发。尚未通过真实停止/继续与子进程退出验收。

Claude Desktop 的外部原会话控制暂不可用，官方 Remote Control 和 Channels 的范围、一次接入候选及权限限制见[调查笔记](./claude-desktop-investigation.md)。内部函数存在不代表本项目已能调用。
