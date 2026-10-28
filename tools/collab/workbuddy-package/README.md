# iO Agent · WorkBuddy 试用包

每日智记 AI 总结已接入 `node io-agent.mjs daily`，stdin 例如 `{"date":"2026-10-26"}` 或 `{"from":"2026-10-23","to":"2026-10-27"}`。已配对电脑可供任意 Agent 或定时任务只读调用，无需当前 session、join 或 Python。只读服务端已同步的每日总结，不读转写、音频或手机文件；空结果不代表当天没有活动。分页按 `has_more` / `next_cursor` 继续，保留原过滤条件；完整参数、来源和权限说明见 [每日总结查询](rebuild/agent-bridge/questions/DAILY-SUMMARIES.md)。

这是可独立解压的眼镜问答 CLI，无需克隆原项目。支持 Windows / macOS / Linux；Windows 和 WorkBuddy 本体的端到端行为尚未实测。
需要 Node.js 22.18 或更新的 22.x、Python 3.10+（含标准库 sqlite3）。不需要 npm install、pip install、Hermes、ADB、手机 USB 或同一 Wi-Fi。眼镜需连接手机，手机 App 和电脑均能联网。双入口需要手机 dev109 或后续版本；扫码/粘贴已接入同一确认流程，Windows 与 WorkBuddy 原会话仍需实际验证。

## 1. 电脑只配对一次

在解压目录运行 `node setup.mjs doctor` 检查环境。然后让 WorkBuddy 读取 AGENTS.md，由它使用宿主提供的真实会话 ID 执行配对。无需把登记文件发回另一台电脑。

以下命令从标准输入读取 JSON（见下一节的身份要求）：

| 命令 | JSON 输入 | 结果 |
| --- | --- | --- |
| `node io-agent.mjs pair` | `{"topic":"本次任务主题","workspace":"实际工作区路径或名称"}` | 返回二维码 HTML 路径、可复制配对字符串 |
| `node io-agent.mjs pair-status` | `{}` | 手机确认后领取电脑授权；未确认则返回 waiting_for_phone |

打开返回的 `qr_html` 文件。手机进入 **iO Agent → 设置 → 电脑连接 → 添加 Agent 会话**，任选一种方式：

- **扫描二维码**：扫描 HTML 页面里的二维码。
- **粘贴配对字符串**：复制 `pairing_string`（以 `io-agent-pair/1:` 开头），粘贴到 App。

两种方式都先显示 Agent、工作区、主题、会话 ID。核对后点 **保存并绑定**，再让 WorkBuddy 执行 `pair-status` 和 `join`。配对信息 10 分钟内有效；配对成功后长期保留，访问凭据自动续期，不需要每天扫码。若生成后超时，重复 `pair` 生成新信息。

二维码和字符串只用于批准这一次绑定。电脑持有的长期续期密钥不在其中；`.io-agent/` 和 `rebuild/agent-bridge/private/` 是私有状态，不再打包转发。服务器只授权当前会话的任务问答，不授予管理员权限。

## 2. 交给 WorkBuddy

让 WorkBuddy 读取本目录 AGENTS.md。宿主为本次真实对话提供：

- `IO_AGENT_CALLER_RUNTIME=workbuddy`
- `IO_AGENT_CALLER_SESSION=<当前真实会话 ID>`，允许字母数字、下划线、点、短横线，最多 128 字符；同一对话每次调用都相同。

不得虚构会话 ID，也不要冒用 Codex/Claude 变量。若 WorkBuddy 无法取得当前真实 ID，先报告限制，由宿主适配；不要拿随机值假装已绑定原会话。不要混入另一个 Agent 的会话环境。

以下 JSON 必须写入命令的标准输入（UTF-8）；结果在标准输出中：

| 命令 | 输入示例 |
| --- | --- |
| `node io-agent.mjs join` | `{"topic":"WorkBuddy 眼镜问答试用"}` |
| `node io-agent.mjs config` | `{"glasses_progress":false}` |
| `node io-agent.mjs ask` | 见下方 |
| `node io-agent.mjs wait` | `{"request_id":"使用 ask 返回的 ID","wait_seconds":30}` |

电脑首次配对后运行 join。后续新会话复用同一电脑凭据，首次 ask / notify / checkpoint 会自动 join；也可先主动 join 设置主题。一次只发一道测试题。示例问答（`expires_at` 必须替换为实际未来 10 分钟内的 UTC 时间，最长一小时）：

```json
{
  "question_key": "workbuddy-first-question",
  "question": "这是 WorkBuddy 的接入测试，你希望我先简短介绍能力，还是结束测试？",
  "mode": "choice",
  "options": [
    {"option_id":"intro","label":"简短介绍能力"},
    {"option_id":"finish","label":"结束测试"}
  ],
  "expires_at": "替换成未来的 UTC ISO 时间，以 Z 结尾"
}
```

保存 request_id。pending 时继续等同一个问题，不重复发题；state=answered 时读取 `answer.body.option_id` 和 `answer.body.text`，在当前 WorkBuddy 对话按答案继续。用户看到题目后长按退出、口述并确认，CLI 才能收到答案。服务器保存不等于眼镜已显示。

## 原厂待办建议

已配对电脑可使用 `node io-agent.mjs todo-add`，标准输入例如 `{"todo_key":"daily-2026-10-27-follow-up","content":"确认物料到货进度","source":"WorkBuddy"}`。它先向眼镜提出建议，用户确认后才由手机加入原厂待办。此命令及 `todo-status` 不需要当前聊天、`join` 或 Python，可用于已有的定时 Agent 任务。

保存返回的 `proposal_id`，以 `node io-agent.mjs todo-status` 和 `{"proposal_id":"返回的标识"}` 查询。同一 `todo_key` 重试保持原内容；`pending_confirmation`、`shown`、`accepted`、`creating` 都不表示创建完成，仅 `native_created: true` 表示手机报告原厂创建成功。`unknown` 时先核对原厂待办，不自动重投。参数、状态及手机前置条件见 [原厂待办 CLI 说明](rebuild/agent-bridge/questions/NATIVE-TODOS.md)。

## 当前边界

- 此包连接的是已经运行的 Agent 会话。不会启动 WorkBuddy，也不能保证从手机远程唤醒、打断或恢复其进程。
- 进度推送默认按用户要求关闭；`notify` 不受这个开关控制，试用时不要连续发通知。
- 电脑配对后新会话无需再次扫码；配对可在长期离线后自动恢复短期凭据；服务器撤销绑定对应的设备后，续期和旧凭据都会失效。旧登记文件使用原有机制，不自动替换其他电脑。
- 这个 ZIP 不含已授权连接。手机需先登录原厂账号，并已有本项目的手机账号配对；此包不能自行创建服务器账号。
- 电脑授权默认保存在用户目录 ~/.turboio/agent-device.json，多个解压目录和 Agent 共用。显式 IO_AGENT_DEVICE_FILE / IO_AGENT_PAIRING_HOME 可隔离配置。旧单会话授权保持原有范围，不自动扩大。移到其他电脑需重新配对，不复制凭据。

## 验证包内容

`MANIFEST.json` 列出源提交和每个文件的 SHA-256。本包不含 APK、历史对话、录音、数据库、用户资料或访问密钥。`rebuild/agent-bridge/hermes/` 内仅为 CLI 复用的 Python 辅助代码，不会启动 Hermes。


## 可选：ACP 受管会话连接器

本包现包含 `node io-agent.mjs connector help`，电脑需使用 Node.js 22.18+。它通过显式配置的 ACP 子进程管理自己的会话；与上面给 WorkBuddy 原会话使用的问答 CLI 分开。不会替换桌面启动器，不接管已经打开的 Desktop 聊天。Claude/Codex 适配器需另行安装并固定版本；包内没有模型引擎或账号密钥。

初始化（JSON 从标准输入传入）：

```sh
node io-agent.mjs connector init --directory /absolute/private/connector
```

```json
{"runtime":"codex","label":"我的受管任务","workspace":"/absolute/workspace","command":["/absolute/node","/absolute/codex-acp/dist/index.js"]}
```

首次使用 `connector pair --directory ...` 生成电脑二维码/字符串，手机确认后用 `connector pair-status --directory ...` 领取授权。此后任何新 profile 直接 `connector run --directory ...`，共用这台电脑授权，无需再次扫码。已有正式电脑配对直接复用，也可显式使用 `run --device /absolute/private/device.json`。关闭该终端会退出连接器；后续 run 恢复已有受管上下文，不重发历史输入。初始化只保存配置；run 建立或恢复原生会话，首次提交任务才发起模型轮次。空会话可能不被原 Agent 持久保存。

工具权限由手机/眼镜选择“仅允许本次”或“拒绝本次”，不自动选择永久授权。通用 ACP 取消尚不能证明所有后台工作已停止，因此保持“停止未确认”，不承诺通用继续。本机 WorkBuddy 5.8.3 的内置 CLI 未完成 ACP 握手；官方独立 CodeBuddy CLI 2.177.0 已握手，创建会话需要登录，尚未完成真实执行。WorkBuddy 官方云端 ACP 另需要第三方应用授权，不包含在本包已验的本地 stdio 路径中。ACP 连接器已在 macOS 验证；Windows/Linux 端执行仍需分别验收。

受管会话的每轮手机任务都会获得 `IO_AGENT_CLI_ARGS`，直接运行 `notify / ask / wait / status`。命令固定绑定原 task、route 和 native turn，不创建替代任务，不再依赖 Python。工具沙箱内只写本地工作区 `.io-agent-cli` 邮箱，常驻连接器负责联网；不扩大 Agent 网络/文件权限。已结束轮次的命令会拒绝，等待同一 request 不重复投题。Agent 仍自行决定是否按任务调用 CLI，未执行命令不能算已投送；服务器保存也不等于镜片实际显示。
