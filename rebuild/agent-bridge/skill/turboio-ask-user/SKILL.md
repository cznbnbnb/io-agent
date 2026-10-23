---
name: turboio-ask-user
description: 在当前已登记的雷鸟 iO 电脑任务中向用户提问，通过固定 CLI 工具等待答案并继续原任务。需要用户选择、补充条件或确认时使用，不用于创建替代会话、修改路由或向其他任务注入答案。
---

# 雷鸟 iO 原任务问答

在本项目当前Agent对话中（Codex、Claude Code 或宿主设置了调用方变量的其他Agent），从 `rayneo-io-agent` 仓库根目录运行 `node rebuild/agent-bridge/questions/cli.mjs ask|wait|status`；Node 应使用宿主已验证的版本。参数JSON走stdin，结果为UTF-8 JSON。Windows 既有环境可使用其已配置的 Node 绝对路径。登记由宿主预先完成，CLI核对当前对话环境与项目：Codex读`CODEX_THREAD_ID`，Claude Code读`CLAUDE_CODE_SESSION_ID`，其他Agent由宿主设置`IO_AGENT_CALLER_RUNTIME`和`IO_AGENT_CALLER_SESSION`；同时出现多个来源时拒绝。模型不得修改登记配置、环境中的会话ID或选择另一个目标。没有登记就报告接入未就绪，保留原任务。用户明确授权接入准备时，宿主可先用 `tools/android/prepare-current-caller.mjs` 完成独立测试身份的登记，随后仍只调用固定问答入口。

Hermes继续使用运行时提供的 `io_ask_user`、`io_wait_answer`、`io_question_status`，绑定和调用语义相同。两条入口都不会创建替代Agent会话。

提问时使用稳定的 `question_key`；重试同一问题保持原问题、选项和期限。`mode=choice` 提供2–4个带 `option_id` 和 `label` 的选项，`mode=free_text` 的 `options=[]`。问题会显示到眼镜上，`ask` 结果里的 `glasses_display` 说明走哪条路：`card` 只用于一行的短口述题（`free_text` 不超过36字），佩戴者按＋口述；所有选择题和较长的问题都是 `prompter` 提词器，开头标明 Agent、项目和会话前8位，完整显示问题和编号选项，佩戴者看完长按退出后口述回答，选择题说“选二”并可补充条件，答案里会带上对应的 `option_id` 和完整原话。没听出唯一选项号时 `option_id` 为空，请按原话理解或再问。一次只问一件事。佩戴者看不到你的对话，问题要自带背景（在做什么、为什么要问），选项写清楚各自的后果。`expires_at` 为未来一小时内的 UTC ISO 时间，以 `Z` 结尾（macOS 可用 `date -u -v+30M +%Y-%m-%dT%H:%M:%SZ`）。

保存返回的 `request_id`，用 `wait`（Hermes为`io_wait_answer`）等待。Hermes每次最多30秒；CLI的`wait_seconds`可到600秒，工具调用能阻塞或后台运行的Agent（如Claude Code）可一次等足，同一时间只挂一个wait。`pending` 继续等待同一请求，不新建问题。`status`只读本机状态，`network_checked=false`，不证明联网或答案已被原任务消费。实际wait消费答案才产生“原任务继续”的回执。

只有 `state=answered` 才使用 `answer.body.option_id` 和 `answer.body.text`。选择与附加文字条件都属于答案，不能只看按钮而忽略条件。`operation_closed` 停止继续执行；`deadline_elapsed` 表示需要连接程序对账，不等于用户拒绝，也不能自动延长期限。

工具超时可能已经落盘。保留原请求和参数，查询或同字节重试；不要以新问题、新任务或新会话绕过不确定状态。收到答案、Agent 接收、任务继续和任务完成分别报告。结果必须根据真实执行事实，不把一次工具返回或 ACP 回合结束当成任务完成。

CLI的离线ask返回错误时，`locally_stored=true`和`request_id`表明原问题仍在本机，应保留同一question_key、内容、选项和期限重试。已经成功领取的同一答案可离线重读，`already_delivered=true`时不要重复执行业务。`awaiting_parent_check`或`sync_pending=true`会保留完整答案，但原任务有效性或继续回执尚未核对完成，不能当作新的继续授权。`cancel_requested`只证明收到停止请求，不能宣称Agent已被后台强制停止。

`ask`参数为 `question_key / question / mode / options / expires_at`；`wait`为`request_id`及可选`wait_seconds`（CLI 0–600，默认30）；`status`只接受`request_id`。问题消失不作拒绝，普通录音不作指令。用户暂停联合验收时，不继续发送合成镜片测试；真实任务提问仍遵循用户当前授权和暂停范围。

已有 CLI 宿主可执行 `<准备好的 Python> -I -S -B <repo>/rebuild/agent-bridge/hermes/question_cli.py ask|wait|status`，参数 JSON 走 stdin，结果 JSON 为 UTF-8。宿主须预先设置本次操作专属 `TURBOIO_QUESTION_CONFIG`；模型不得自行寻找、更换或写入此配置。通常直接调用上述固定工具，无需开放通用终端权限。
