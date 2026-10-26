# 主动委托完成摘要提案

**状态：PROPOSED / NOT IMPLEMENTED。** 本文记录 2026-10-25 的只读设计，不代表代码、服务器、手机或眼镜已经实现。完成摘要不在当前批次实施；当前优先接通既定三项主路径，之后再决定本提案的合同与范围。

目标是：用户在手机或眼镜主动委托的新任务完成后，眼镜最多投送一次简短摘要，完整结果在手机查看。结果分片到达、旧任务回读、重新配对和已关闭问题均不能触发连续提词器。这里的“最多一次”指持久去重后的投送尝试，不承诺硬件一定显示，也不将提交成功当成佩戴者已看见。

## 现有实现与缺口

| 现有代码 | 已有行为 | 本提案需要补充的内容 |
| --- | --- | --- |
| `rebuild/agent-bridge/hosts/native-runtime.mjs` | 完整结果最多 1 MiB，分成最多 62 个 `channel: result` 消息；结果先于 completed 状态和完成回执发布。 | 分片没有可供手机核验的完整清单、command 身份和整文哈希。不能从一个分片或 completed 状态推断手机已存完整结果。 |
| `rebuild/android-app/src/com/turboio/addon/TaskNotice.java` | 仅接受 `notice-*`、`progress` 消息及活跃任务，拒绝完成任务和普通结果。 | 应保留这条边界，不将 result 分片变成进度通知。 |
| `TaskNoticeQueue.java` | 按任务选择最新进度，先持久 claim 再调用 SDK，存在安静间隔和不确定投送不重试策略。 | 完成摘要须按 task + command 单独去重，不能使用进度流序号代替。 |
| `TaskMailbox.java`、`AgentDelegateSession.java` | 本机主动委托有耐久操作与原始 task 入队内容。 | 尚无“此次明确允许完成摘要”的来源标记；不能把旧 outbox 或 task ID 前缀自动升级为授权。 |
| `AgentCardRuntime.java`、`TaskAttention.java` | 有眼镜提醒开关、前后台许可、连接状态、问答/录音/确认卡及通知占用门禁。 | 可以复用门禁和纯通知显示入口；不改变问答退出后口述的现有行为。 |

目前手机 inbox 页按顺序落盘，`inboxCurrent` 表示分页追平；它不是结果完整性证明。手机存储失败、漏片或摘要合同缺失时，只显示实际已知的手机状态，不推送完成摘要。

## 建议的最小结果合同

在 completed task body 增加可选 `result_manifest`，旧任务没有该字段仍按原合同工作，但不产生本功能的自动摘要：

```json
{
  "command_id": "<本次 execution.command_id UUID>",
  "parts": [
    {"message_id": "<result 消息 ID>", "sha256": "<该片原文 UTF-8 SHA-256>"}
  ],
  "utf8_bytes": 123,
  "sha256": "<按 parts 顺序连接后的原文 UTF-8 SHA-256>"
}
```

建议约束：

- 仅 completed 且 `execution.phase: completed` 的任务可声明；command ID 必须精确相同，不能映射到最新轮次。
- 清单按原文顺序排列，1–62 个唯一消息 ID，整文最多 1 MiB。沿用当前结果生成器，空结果也提供一个明确的空分片、零字节数和空字符串哈希；缺片不等于空结果。
- 每片必须是同 owner、同完整 route、同 task 的 `channel: result` 消息。发布清单的电脑身份须有 `receipts:agent`；清单引用的分片与该认证 producer 对应，不能混入其他任务或命令的消息。
- 服务端接受 completed + manifest 前核对所有分片已经存储、哈希匹配、整文长度与哈希匹配。保持“分片 → completed + manifest → receipt”的顺序；本提案不要求新增每片眼镜事件。
- 手机逐片核对并确认完整结果已耐久保存后才生成候选。completed 先到、分片乱序、缺片、重复、哈希冲突或本地存储失败，都不能提前提示。

这是建议合同，尚未修改 event schema、服务器校验、bridge action 或手机解析器。是否采用 manifest、最终字段和版本兼容方式，须在后续批次确认。

## 主动委托的来源绑定

建议在新主动委托入队的**同一次原子写入**中增加本地可信来源记录，包含：

- 来源 `phone_delegate` 或 `glasses_delegate`，原 operation ID、task ID、server、owner 和完整四字段 route。
- 用户确认时间，以及明确的 `completion_policy: glasses_once | phone_only`。
- 原入队请求及其 server-stored 回执的对应关系。

只有手机委托确认入口或眼镜 `AgentDelegateSession` 确认入口可以创建此标记。不能从 `task-android-*` 前缀、Agent 名称、云端自报字段、默认目标或历史 outbox 推断来源。旧任务不回填标记；在另一台手机读取任务，也不因此获得新的投送许可。

候选必须与本地原始委托及有效入库回执精确对应，且当前 task 的 completed execution 与 manifest 属于同一个 command。继续操作若产生新 command，必须遵守后续批准的控制合同；本提案不扩大 stopped/resume 语义。

## 去重与显示

建议去重键为 `hash(server, owner, route, task_id, command_id)`，不包含令牌、配对 binding、默认选择或展示时间。这样刷新凭据、重新读取、重复分页和默认切换不会制造新的摘要身份。

新增独立完成摘要账本：校验完整结果 → 生成候选 → 持久 claim → 调用显示入口。存盘失败则不调用 SDK；发送后状态不明不自动重试，完整结果仍可在手机查看。账本跨进程恢复，旧来源没有标记则不投送。去重记录的保留和容量须与任务保留期配套，不能简单丢掉旧键后重新扫描历史产生重播。

展示建议为一条约 160 个 Unicode 代码点以内的短文，包含 Agent、任务名称或结果首段短摘录及“详情在手机”。按代码点截断、清理不可显示控制字符；不额外启动模型生成摘要，不逐分片提示。手机详情按 manifest 重组完整结果，避免把分片当成多个独立完成任务。

可复用 `AgentCardRuntime` 的 `noticePrompt` / `NewsTele.notice`：这是纯通知，退出后不进入录音。保留眼镜提醒总开关、前后台许可、profile 是否启用、登录/连接状态、`TaskAttention`、`NewsTele`、`NativeTransfer`、头势与卡片资源门禁；问答、口述和确认卡优先。完成摘要应位于低优先级调度分支，并遵守统一安静间隔。

建议只允许完成后的有限新鲜窗口，例如 10 分钟；具体时长尚待确定。过龄或静音期间完成的候选记为 suppressed/expired，不在以后重新开启开关时补播积压历史。

## 静音与 watch 的边界

当前 CLI 的 `glasses_progress` 保存在 `progress-policy.json`，同时控制服务器的每任务 watch；手机并未读取这份 CLI 策略。手机已有 `AgentCardRuntime.enabled()` 眼镜提醒总开关。二者不是一个已同步的全局设置。

因此本功能不能宣称已自动继承一个读取不到的 CLI 静音状态，也不能通过 `checkpoint`、`notify` 或 `watchSet` 重新开启进度推送。建议完成摘要仅由新委托的显式 `completion_policy` 决定，并同时受手机眼镜提醒总开关限制；策略未知或静音时使用 `phone_only`。watch 继续保持原值，不新增周期进度提醒。

**待确认产品选择：** 用户在手机/眼镜主动委托时，是否明确选择“完成后在眼镜提示一次”；是否允许把该确认作为独立于进度 watch 的一次性通知许可。没有确认前，不默认为开启，也不迁移旧任务为开启。

## 后续实现范围与验收

可能涉及 event schema 和服务端 manifest 验证；native-runtime、runtime-events、bridge 的完整结果清单；Android TaskWire、TaskMailbox、TaskHub 和两个委托入口的本地来源记录；新增完成摘要及账本纯逻辑；AgentCardRuntime 调度与手机任务详情。无需放宽 TaskNotice 对 progress/活跃任务的限制，也无需改变 TaskAttention 或原问答闭环的语义。

自动化应覆盖完整 62 片、空结果、错哈希、漏片、乱序、completed 先到、本地存储满/失败、分页和重启恢复、重新配对去重、静音后不补播、旧任务零投送，以及 claim 落盘失败时零 SDK 副作用。硬件验收再确认只有一条摘要、没有抢占录音/确认卡、退出不录音、完整内容在手机可读。模拟投送通过不能替代佩戴者实际看到的结果。

以上均为待实施与待验收范围；本批没有为此修改代码、部署服务器或安装手机包。
