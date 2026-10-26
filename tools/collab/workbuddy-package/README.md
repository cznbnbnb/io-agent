# iO Agent · WorkBuddy 试用包

这是可独立解压的眼镜问答 CLI，无需克隆原项目。支持 Windows / macOS / Linux；Windows 和 WorkBuddy 本体的端到端行为尚未实测。
需要 Node.js 22.18 或更新的 22.x、Python 3.10+（含标准库 sqlite3）。不需要 npm install、pip install、Hermes、ADB、手机 USB 或同一 Wi-Fi。眼镜需连接手机，手机 App 和电脑均能联网。

## 1. 检查和登记新电脑

在解压目录打开终端：

```text
node setup.mjs doctor
node setup.mjs request
```

把生成的 **enrollment-request.json** 发回原来的 Codex 对话。这个文件只有电脑标识和服务地址，没有密码或 token。收到为这台电脑单独签发的连接文件后：

```text
node setup.mjs import-device 收到的连接文件.json
node io-agent.mjs device-status
```

只转发本 ZIP 和不含密钥的登记请求；连接文件和运行后生成的 `.io-agent/`、`rebuild/agent-bridge/private/` 是私有状态，不再打包给别人。不要复制原电脑凭据或 SSH 私钥。导入会验证服务器与电脑身份，不覆盖另一条已保存连接。

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

先 join，再关闭进度推送，然后一次只发一道测试题。示例问答（`expires_at` 必须替换为实际未来 10 分钟内的 UTC 时间，最长一小时）：

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
- 电脑问答凭据当前仍是旧的一天访问期，正常调用可在到期前更新；离线超过有效期可能需要重新登记。刚完成的“资料长期配对”属于手机每日总结同步，不能当成电脑问答也已永久续期。
- 这个 ZIP 不含已授权连接。第一次使用必须完成第 1 步；不会向新电脑分发服务器管理员权限。
- 运行状态与解压目录有关，登记后保持目录位置。移到其他电脑时重新登记，不复制运行状态。

## 验证包内容

`MANIFEST.json` 列出源提交和每个文件的 SHA-256。本包不含 APK、历史对话、录音、数据库、用户资料或访问密钥。`rebuild/agent-bridge/hermes/` 内仅为 CLI 复用的 Python 辅助代码，不会启动 Hermes。
