---
name: turboio-ask-user
description: 在当前已登记的雷鸟 iO 电脑任务中向用户提问，通过固定 CLI 工具等待答案并继续原任务。需要用户选择、补充条件或确认时使用，不用于创建替代会话、修改路由或向其他任务注入答案。
---

# 雷鸟 iO 原任务问答

在本项目当前Codex对话中，工作目录保持为 `D:/Project/雷 鸟IO AI 眼镜独立APP开发`，使用 `D:/openclaw/nodejs/node.exe rebuild/agent-bridge/questions/cli.mjs ask|wait|status`。参数JSON走stdin，结果为UTF-8 JSON。登记由宿主预先完成，CLI核对当前对话环境与项目；模型不得修改登记配置、环境中的会话ID或选择另一个目标。没有登记就报告接入未就绪，保留原任务。

Hermes继续使用运行时提供的 `io_ask_user`、`io_wait_answer`、`io_question_status`，绑定和调用语义相同。两条入口都不会创建替代Agent会话。

提问时使用稳定的 `question_key`；重试同一问题保持原问题、选项和期限。`mode=choice` 提供2–4个带 `option_id` 和 `label` 的选项，`mode=free_text` 的 `options=[]`。`expires_at` 为未来一小时内的 UTC ISO 时间，以 `Z` 结尾。

保存返回的 `request_id`，用 `wait`（Hermes为`io_wait_answer`）等待，每次最多30秒。`pending` 继续等待同一请求，不新建问题。`status`只读本机状态，`network_checked=false`，不证明联网或答案已被原任务消费。实际wait消费答案才产生“原任务继续”的回执。

只有 `state=answered` 才使用 `answer.body.option_id` 和 `answer.body.text`。选择与附加文字条件都属于答案，不能只看按钮而忽略条件。`operation_closed` 停止继续执行；`deadline_elapsed` 表示需要连接程序对账，不等于用户拒绝，也不能自动延长期限。

工具超时可能已经落盘。保留原请求和参数，查询或同字节重试；不要以新问题、新任务或新会话绕过不确定状态。收到答案、Agent 接收、任务继续和任务完成分别报告。结果必须根据真实执行事实，不把一次工具返回或 ACP 回合结束当成任务完成。

Codex的离线ask返回错误时，`locally_stored=true`和`request_id`表明原问题仍在本机，应保留同一question_key、内容、选项和期限重试。已经成功领取的同一答案可离线重读，`already_delivered=true`时不要重复执行业务。`awaiting_parent_check`或`sync_pending=true`会保留完整答案，但原任务有效性或继续回执尚未核对完成，不能当作新的继续授权。`cancel_requested`只证明收到停止请求，不能宣称Codex已被后台强制停止。

`ask`参数为 `question_key / question / mode / options / expires_at`；`wait`为`request_id`及可选`wait_seconds`；`status`只接受`request_id`。问题消失不作拒绝，普通录音不作指令。用户暂停联合验收时，不继续发送合成镜片测试；真实任务提问仍遵循用户当前授权和暂停范围。

已有 CLI 宿主可执行 `<准备好的 Python> -I -S -B <repo>/rebuild/agent-bridge/hermes/question_cli.py ask|wait|status`，参数 JSON 走 stdin，结果 JSON 为 UTF-8。宿主须预先设置本次操作专属 `TURBOIO_QUESTION_CONFIG`；模型不得自行寻找、更换或写入此配置。通常直接调用上述固定工具，无需开放通用终端权限。
