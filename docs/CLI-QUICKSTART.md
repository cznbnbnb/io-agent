# 给另一个 Agent：连接我的眼镜

只试用 CLI，先下载 [cz-iot-cli ZIP](distribution/cz-iot-cli.zip)，解压到独立目录，读取包内的 `AGENTS.md` 和 `README.md`。不需要构建手机 App、启动服务器，也不需要 USB、ADB、同一个 Wi-Fi 或复制其他电脑的密钥。

本仓库为私有仓库。浏览器没登录或 Agent 没有仓库读取权限时，链接可能显示 404；先使用你自己的 GitHub 登录或已配置的 Git 认证。不要为了下载让仓库公开，也不要向其他人索要密钥。

## 1. 准备环境

需要 Node.js 22.18+ 的 22.x 和 Python 3.10+（带标准库 sqlite3）。自动更新另外需要 Git，以及对本私有仓库的读取权限。

```sh
node setup.mjs doctor
node cz-iot-cli.mjs help
```

Windows PowerShell 5.1 先设置无 BOM 的 UTF-8 管道编码，避免中文变成问号：

```powershell
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
```

若要求文件全部放 D 盘，每次调用保持相同的 `IO_AGENT_PAIRING_HOME`（例如 `D:\Project\cz-iot-cli\.pairing-home`），并用 `node cz-iot-cli.mjs`，不必执行默认写入系统目录的 npm 全局安装。

不需要安装第三方 Node/Python 依赖。想在任意目录使用短命令，可在**配对之前**执行：

```sh
npm install --global --offline --ignore-scripts .
cz-iot-cli help
```

后续 `cz-iot-cli <命令>` 与 `node cz-iot-cli.mjs <命令>` 相同。JSON 参数通过 UTF-8 标准输入传入，结果是 JSON。

## 2. 使用当前真实会话生成绑定

由实际要对话的 Agent 执行，不能让其他 Agent 代建一条假会话：

- Codex / Claude Code：沿用宿主提供的真实会话环境，不覆盖原会话 ID。
- WorkBuddy 或其他 Agent：宿主提供 `IO_AGENT_CALLER_RUNTIME` 和 `IO_AGENT_CALLER_SESSION`。后者必须是当前真实聊天 ID；无法取得时报告限制，不随机编一个。

执行 `node cz-iot-cli.mjs pair`，stdin 示例由 Agent 填写真实工作区：

```json
{"topic":"跨电脑眼镜双向测试","workspace":"<实际工作区的绝对路径>"}
```

返回两种等价入口：`qr_html` 是本机二维码页面；`pairing_string` 是可复制到手机的绑定字符串。它们10分钟内有效，只给这次绑定使用，不要提交到仓库。

手机进入 **iO Agent → 设置 → 电脑与 Agent → 添加/扫码绑定**，扫描二维码或粘贴绑定字符串，核对 Agent、主题和工作区，点击**保存并绑定**。由用户在自己的手机上完成确认。

然后执行：

| 命令 | 标准输入 | 成功条件 |
| --- | --- | --- |
| `node cz-iot-cli.mjs pair-status` | `{}` | `paired:true`；若等待手机，继续查同一次绑定 |
| `node cz-iot-cli.mjs join` | `{"topic":"跨电脑眼镜双向测试"}` | 已登记当前真实会话 |
| `node cz-iot-cli.mjs config` | `{"glasses_progress":false}` | 关闭自动进度催报，保留主动测试消息 |

一台电脑只配对一次；后续新会话复用电脑授权，首次投送会自动接入。`pair` 返回 `paired:true` 是已配对，不是失败。若专门测试“重新扫码”，使用一个新建的空私有目录作为 `IO_AGENT_PAIRING_HOME`，本次所有调用保持同一目录；不要删除正常使用的共享授权或修改默认工作区。

## 3. 做一轮双向测试

一次只测一道题，收到答案或结束本题后再测下一种格式。多道题和待办一起发送会争用镜片；不要因为 pending 就换键重发。`NATIVE_HOST_UNSUPPORTED` 只表示没有当前宿主的常驻唤醒/下发适配；当前会话继续调用 `wait/status`，仍可读回眼镜答案并接着工作，不需要因此让用户回聊天补一句。

用户戴好眼镜并同意开始后，先发**一条** `notify`。消息示例“新 Agent 已连接，这是眼镜测试消息”；`expires_at` 由 Agent 生成未来5分钟的 UTC ISO 时间。接着用 `ask` 发一道选择题：

```json
{
  "question_key":"first-glasses-roundtrip",
  "question":"你在眼镜上看到了这道测试题吗？",
  "mode":"choice",
  "options":[
    {"option_id":"seen","label":"看到了"},
    {"option_id":"finish","label":"结束测试"}
  ],
  "expires_at":"<由 Agent 生成未来5分钟的 UTC ISO 时间>"
}
```

保存 `ask` 返回的 `request_id`，调用 `wait`，stdin 为 `{"request_id":"<原ID>","wait_seconds":25}`。pending 时只等同一个 ID，不重复发题。

用户看完后退出提词器、口述，再确认答案。Agent 收到 `state:answered`，读取选项和原话，在**原会话**继续回答，这才算双向闭环。服务器接收并不等于用户已看到；若只有 `server_stored`，如实说明还缺镜片或回答证据。测试不要自动创建待办、读日常、改手机权限或修改其他会话。

## 4. 自助更新

CLI 0.2.0 起支持：

```sh
cz-iot-cli update --check
cz-iot-cli update
```

未安装短命令时，用 `node cz-iot-cli.mjs update`。默认通过 Git SSH 读取本仓库的 `codex/agent-workspace-ui` 分发通道；使用 Git HTTPS 认证的电脑可加 `--https`。

更新先核对 ZIP 与内部文件摘要，再替换清单中的代码；保留配对、私有会话和未列出的文件，不自动重绑、不触碰手机。普通文件替换失败会恢复本次已替换代码。不要并发更新；断电等中断后请重新执行更新，不宣称跨多个文件的原子升级。

普通 CLI 下次调用生效；已经运行的受管连接器/会话监听器需要在任务结束后重启，更新命令不会关闭正在工作的 Agent。返回 `running_connectors_need_restart:true` 就是这项提醒。旧版没有 update 时，先下载此包替换代码一次，再使用后续更新命令。

## 其他可用能力

| 命令 | 功能 |
| --- | --- |
| `notify` / `ask` / `wait` / `status` | 投送消息、提问及读回原会话答案 |
| `daily` | 已同步的总结、分段智记和转写；默认取指定日期完整有效文字 |
| `daily-context` | 已同步的原厂活动、定位和日历；精细点仅 `include_points:true` 时返回 |
| `daily-correct` / `daily-note` / `daily-history` / `daily-revert` | 服务器原文订正、补充及撤销，不回写手机 |
| `todo-add` / `todo-status` | 先在眼镜建议，用户确认后加入原厂待办 |

CLI 0.2.1 起，智记订正前先读 `daily` / `daily-history` / `help` 的 `correction_guidance`。每日总结和分段智记保留原日记口吻、视角、标题和自然段节奏；事实优先，必要删改可以做。编辑说明放 `reason` / `evidence`，不混入正文；不只凭 `speaker=others` 断言本人未参与。逐字转写保持原话结构，后续事实用 `daily-note`。

`summary_stale` 时先用 `daily-history` 读原总结，再结合有效转写修正并携带最新 `dependencies_version`；提交后用 `daily` 回读确认生效。详见 [智记查询与订正规范](../rebuild/agent-bridge/questions/DAILY-SUMMARIES.md)。

CLI 0.2.2 起，分析、提取待办和订正必须结合逐句 `blocks[].speaker`（原厂 `me` / `others`）、时间与语境，不能只读无标注的合并正文。对人名、品牌、型号等信息，使用 Agent 现有已授权的微信、飞书及项目资料交叉核对；记忆只作线索，不凭词频或搜索零命中强改，证据保留渠道、时间和可核查来源。无法访问时如实说明。CLI 本身不新增微信/飞书接口。

只在用户要求时使用相应资料/待办能力。已配对不等于有管理员权限。未知 Agent 的问答 CLI 不代表支持从手机唤醒或打断其原生进程；这需要单独的宿主适配或受管 ACP 接口。

配对及更新故障详见 [完整使用说明](../tools/collab/workbuddy-package/README.md)。发布包 [SHA256SUMS](distribution/SHA256SUMS) 可用于下载校验，ZIP 不包含已授权连接、账号密钥、数据库、智记或原音。
