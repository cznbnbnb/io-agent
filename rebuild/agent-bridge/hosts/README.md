# 现有 Agent 会话控制

本目录按已批准的[实施计划](../../../docs/product/DEFAULT-AGENT-CONTROL-PLAN.md)开发。目前只有 Codex 桌面宿主适配基础，尚未连接手机任务分派；Claude、实际执行/打断验收和眼镜主动入口仍在开发。

`codex-desktop.mjs` 通过已运行桌面的本机 Unix socket 找到原会话持有者，沿用其模型、工作目录和权限。不会另起 app-server、resume 同一会话、接管所有权或代答审批。私有协议只接受 `codex-desktop-profile.json` 核验过的安装源码；桌面更新后须重新核对，未知版本明确拒绝。

首次快照之后只保留会话/轮次元信息，接收连续修订补丁；旧对话正文、图片和工具输出不进入状态结果。监听断开、修订缺失或结构变化后，缓存不能用于执行。内部协议仍需接收一次完整快照，最大 256 MiB；超限拒绝。本批对当前长对话的实际只读验证得到 59 个已加载轮次、约 18 KiB 保留元信息，不等于实际控制验收。

从真实 Codex 对话运行只读检查：

```sh
node tools/collab/probe-codex-desktop.mjs
```

定向测试使用独立本机 Unix socket 和模拟桌面持有者，不会向真实对话发送输入：

```sh
node --test rebuild/agent-bridge/tests/codex-desktop.test.mjs
```

`start()` 要求空闲且指定 `clientUserMessageId`。调用方必须先持久化任务、精确路由、操作 ID 与输入摘要；请求超时或断线后的结果标为不明，不能盲目再发。`inspectOperation()` 在已加载历史没找到操作时仍返回不明，不能把部分历史当成从未执行。忙碌时的耐久排队由下一层桥接实现。

`interrupt(expectedTurnId)` 只向原持有者提交精确轮次的停止请求；原轮次不再活跃时不会发送。返回 `requested` 只代表宿主回执，`confirmedStopped` 始终为 false。桥接必须随后取得该轮次终态并核验受控子任务退出，才能向手机显示“已停止”。尚未实现结果提取、持久化恢复、宿主端到端验收或手机控制状态；不要把本模块直接视为已交付的执行适配器。
