# 原厂待办建议 CLI

2026-10-27：Agent 可以在检查每日总结后提出待办建议。手机把建议显示到眼镜，用户点头确认后才创建原厂待办；摇头忽略不创建。手势沿用原厂设置，CLI 不修改手势开关。

这两个命令复用电脑长期配对，不需要当前 Agent session、`join` 或 Python，适合已有的定时 Agent 任务。电脑尚未配对时先完成一次配对；手机需要安装支持待办建议的版本，并保持可联网运行。本文不创建任何定时任务。

普通/便携入口：

```sh
node cz-iot-cli.mjs todo-add
```

通过标准输入传 JSON：

```json
{"todo_key":"daily-2026-10-27-material-follow-up","content":"确认门铃物料到货进度","source":"Codex"}
```

| 字段 | 约定 |
| --- | --- |
| `todo_key` | 必填，1–96 个字母、数字、下划线、点或短横线；同一件建议重试时保持不变 |
| `content` | 必填，单行、不含控制字符，最多48个UTF-16代码单元；不要用正文片段代替简短可执行的待办 |
| `source` | 可选，最多20个字符的 Agent 显示名称，默认“Agent 建议”；不改变原厂待办的保存来源 |
| `expires_at` | 可选，未来24小时内的ISO时间；默认24小时，过期未确认不创建 |

命令返回 `proposal_id` 和 `state`。同一电脑的同一 `todo_key` 与内容重试，返回原建议；同键改内容会得到 `TODO_KEY_CONFLICT`，不要用新键掩盖一次结果未知的写入。

查询原建议：

```sh
node cz-iot-cli.mjs todo-status
```

```json
{"proposal_id":"使用 todo-add 返回的 proposal_id"}
```

| 状态 | 可以向用户报告什么 |
| --- | --- |
| `pending_confirmation` / `shown` | 建议等待确认；还没有添加原厂待办 |
| `accepted` / `creating` | 已确认，手机正在处理；还不能报告创建完成 |
| `created` 且 `native_created: true` | 手机已报告原厂创建成功；`native_id` 是原厂返回的标识 |
| `declined` / `expired` | 已忽略或到期；不创建 |
| `failed` | 手机报告了明确失败，查看 `error` |
| `unknown` | 原厂写入结果未确认；先核对原厂待办，不能自动重发创建 |

`glasses_display_confirmed: false` 表示没有镜片实际显示的确认，不能把服务器接收、原厂创建成功或刷新调用当作用户已经看到。

受管手机任务可使用该轮 `IO_AGENT_CLI_ARGS`，在固定 argv 后加 `todo-add` 或 `todo-status`，JSON仍从标准输入传入。此入口继续绑定原任务；任务结束后不要复用旧上下文。CLI不创建 Agent 待执行任务，也不把待办另存成一套私有清单；确认后的保存来源为原厂 RayNeoTasks。
