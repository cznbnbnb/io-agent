# iO Agent · WorkBuddy 试用包

这是可独立解压的眼镜问答 CLI，无需克隆原项目。支持 Windows / macOS / Linux；Windows 和 WorkBuddy 本体的端到端行为尚未实测。
需要 Node.js 22.18 或更新的 22.x、Python 3.10+（含标准库 sqlite3）。不需要 npm install、pip install、Hermes、ADB、手机 USB 或同一 Wi-Fi。眼镜需连接手机，手机 App 和电脑均能联网。

## 1. 在对应的真实会话中配对

在解压目录运行 `node setup.mjs doctor` 检查环境。然后让 WorkBuddy 读取 AGENTS.md，由它使用宿主提供的真实会话 ID 执行配对。无需把登记文件发回另一台电脑。

以下命令从标准输入读取 JSON（见下一节的身份要求）：

| 命令 | JSON 输入 | 结果 |
| --- | --- | --- |
| `node io-agent.mjs pair` | `{"topic":"本次任务主题","workspace":"实际工作区路径或名称"}` | 返回二维码 HTML 路径、可复制配对字符串 |
| `node io-agent.mjs pair-status` | `{}` | 手机确认后领取当前会话连接；未确认则返回 waiting_for_phone |

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

完成配对后先 join，再关闭进度推送，然后一次只发一道测试题。示例问答（`expires_at` 必须替换为实际未来 10 分钟内的 UTC 时间，最长一小时）：

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

## 当前边界

- 此包连接的是已经运行的 Agent 会话。不会启动 WorkBuddy，也不能保证从手机远程唤醒、打断或恢复其进程。
- 进度推送默认按用户要求关闭；`notify` 不受这个开关控制，试用时不要连续发通知。
- 新会话绑定可在长期离线后自动恢复短期凭据；服务器撤销绑定对应的设备后，续期和旧凭据都会失效。旧登记文件使用原有机制，不自动替换其他电脑。
- 这个 ZIP 不含已授权连接。手机需先登录原厂账号，并已有本项目的手机账号配对；此包不能自行创建服务器账号。
- 运行状态与解压目录有关，登记后保持目录位置。移到其他电脑时重新登记，不复制运行状态。

## 验证包内容

`MANIFEST.json` 列出源提交和每个文件的 SHA-256。本包不含 APK、历史对话、录音、数据库、用户资料或访问密钥。`rebuild/agent-bridge/hermes/` 内仅为 CLI 复用的 Python 辅助代码，不会启动 Hermes。
