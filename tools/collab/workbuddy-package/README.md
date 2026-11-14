# cz-iot-cli

CLI 0.2.6 新增[同账号共享个人词库](rebuild/agent-bridge/questions/LEXICON.md)：人名、项目和常用术语存于服务器，已配对的不同电脑共用，个人词条不在安装包中。`lexicon query/save/use/delete` 分别查询、核实保存、确认使用和删除；查询不续期，六个自然月未用自动清理。新核实词可随成功的 `daily-correct.lexicon_entries` 一次保存。词库用于减少重复查词，当前事件、发言人与责任仍要按 V4 查证。

## 内置智记订正 V4（CLI 0.2.5 起）

完整流程、参考规则、每日任务提示词和本地复核脚本随 CLI 分发。Agent 无需另装技能，先运行：

```sh
node cz-iot-cli.mjs skill check
node cz-iot-cli.mjs skill read
```

`skill` 显示版本、绝对入口路径和文件列表；`skill read references/event-review.md` 读取对应规则。脚本位置由 `skill` 的 `helper` 返回，运行 `python <helper路径> --version` 应输出 `cz-lifelog-correct v4`。辅助脚本需要 Python 3.10+，无第三方依赖。`help/daily` 的 `correction_guidance.skill` 指向同一版本。受管任务使用本轮 `IO_AGENT_CLI_ARGS` 后接 `skill`，stdin 为 `{"file":"SKILL.md"}`。

先查本人参与和录音串场，再查外部证据、逐句最小修改；按转写、分段、每日总结顺序写回并回读。脚本处理本地快照、请求及校验；外部查询、事实判断和云端写回仍由获得对应授权的 Agent 执行。运行记录放在技能目录之外。

`node cz-iot-cli.mjs update --check --https` 检查更新，`node cz-iot-cli.mjs update --https` 更新 CLI 和随包技能。新版拒绝更低 CLI 版本；同版本代码有差异仍会核对更新。配对和独立数据目录保留。定时任务若写死旧独立技能路径，需要改为先读取 CLI 随包技能；更新不会自动修改既有任务提示词或调度。

这是 cz-iot-cli 的便携发行包。首次接入按下方“电脑只配对一次”操作；本包只含代码，没有这台电脑的配对凭据。通过公开仓库更新用 `node cz-iot-cli.mjs update --check --https` / `node cz-iot-cli.mjs update --https`，见文末说明。

每日智记 AI 总结已接入 `node cz-iot-cli.mjs daily`，stdin 例如 `{"date":"2026-10-26"}` 或 `{"from":"2026-10-23","to":"2026-10-27"}`。已配对电脑可供任意 Agent 或定时任务只读调用，无需当前 session、join 或 Python。读取服务端已同步的总结、分段智记和逐字转写；不读音频或手机文件；空结果不代表当天没有活动。指定日期自动取全，显式分页时按 `has_more` / `next_cursor` 继续，保留原过滤条件；完整参数、来源和权限说明见 [每日总结查询](rebuild/agent-bridge/questions/DAILY-SUMMARIES.md)。

这是可独立解压的眼镜问答 CLI，无需克隆原项目。支持 Windows / macOS / Linux；Windows 和 WorkBuddy 本体的端到端行为尚未实测。
需要 Node.js 22.18 或更新的 22.x、Python 3.10+（含标准库 sqlite3）。不需要 npm install、pip install、Hermes、ADB、手机 USB 或同一 Wi-Fi。眼镜需连接手机，手机 App 和电脑均能联网。双入口需要手机 dev109 或后续版本；扫码/粘贴已接入同一确认流程，Windows 与 WorkBuddy 原会话仍需实际验证。

## 正式命令名称

解压后直接运行 `node cz-iot-cli.mjs help`，无需安装依赖。若想在任意目录直接使用 `cz-iot-cli`，可在解压目录执行一次：

```sh
npm install --global --offline --ignore-scripts .
cz-iot-cli help
```

这只是从本地目录注册命令，不访问 npm 服务或安装第三方依赖。请保留解压目录。下文的 `node cz-iot-cli.mjs <命令>` 与安装后的 `cz-iot-cli <命令>` 用法相同。

旧的 `node io-agent.mjs` 入口仍转到同一实现，已有 Agent 指令继续可用。改名沿用原来的电脑配对、会话路由和私有配置，不要求重扫二维码。`IO_AGENT_*` 环境变量、`io-agent-pair/1:` 配对格式和 `.turboio` 配置路径属于兼容接口，继续使用原值。

## 1. 电脑只配对一次

在解压目录运行 `node setup.mjs doctor` 检查环境和已有电脑授权。输出包含 CLI 的绝对路径、版本及 `computer` 状态：`paired:true` 表示已向服务器核实，可以直接 `join`；`paired:false` 才需要首次扫码；`paired:null` 表示已有授权但验证失败，应按错误排查网络或授权，不要反复生成二维码。检查会自动续期已有电脑访问凭据，不登记新的会话。

让 WorkBuddy 读取 AGENTS.md，由它使用宿主提供的真实会话 ID 接入。已绑定电脑的新会话可直接 `join`；首次 `ask` / `notify` / `checkpoint` 也会自动登记自己的 session ID，返回的 `computer_paired` 与 `session_registered` 分别表示电脑授权和本会话接入。无需把登记文件发回另一台电脑。

同一系统用户的各个项目、Agent 和 CLI 安装共用 `~/.turboio/agent-device.json` 的电脑授权。更新或重新解压代码保留它；不要把凭据放在项目里或分享给其他电脑。显式设置 `IO_AGENT_DEVICE_FILE` / `IO_AGENT_PAIRING_HOME` 会改变查找位置，不同安装应使用相同配置。旧单会话凭据仍保留；已有同账号、同服务器的电脑授权时优先使用，身份不一致会拒绝接入。配对尚未完成时，更换会话会复用仍有效的电脑二维码。

以下命令从标准输入读取 JSON（见下一节的身份要求）：

| 命令 | JSON 输入 | 结果 |
| --- | --- | --- |
| `node cz-iot-cli.mjs pair` | `{"topic":"本次任务主题","workspace":"实际工作区路径或名称"}` | 返回二维码 HTML 路径、可复制配对字符串 |
| `node cz-iot-cli.mjs pair-status` | `{}` | 手机确认后领取电脑授权；未确认则返回 waiting_for_phone |

打开返回的 `qr_html` 文件。手机进入 **iO Agent → 设置 → 电脑连接 → 添加 Agent 会话**，任选一种方式：

- **扫描二维码**：扫描 HTML 页面里的二维码。
- **粘贴配对字符串**：复制 `pairing_string`（以 `io-agent-pair/1:` 开头），粘贴到 App。

两种方式都先显示 Agent、工作区、主题、会话 ID。核对后点 **保存并绑定**，再让 WorkBuddy 执行 `pair-status` 和 `join`。配对信息 10 分钟内有效；配对成功后长期保留，访问凭据自动续期，不需要每天扫码。若生成后超时，重复 `pair` 生成新信息。

二维码和字符串只用于批准这一次绑定。电脑持有的长期续期密钥不在其中；`.io-agent/` 和 `rebuild/agent-bridge/private/` 是私有状态，不再打包转发。手机批准后，这台电脑的后续 CLI 会话可复用配对；每次问答仍绑定真实原会话，不授予管理员权限。

## 2. 交给 WorkBuddy

让 WorkBuddy 读取本目录 AGENTS.md。宿主为本次真实对话提供：

- `IO_AGENT_CALLER_RUNTIME=workbuddy`
- `IO_AGENT_CALLER_SESSION=<当前真实会话 ID>`，允许字母数字、下划线、点、短横线，最多 128 字符；同一对话每次调用都相同。

不得虚构会话 ID，也不要冒用 Codex/Claude 变量。若 WorkBuddy 无法取得当前真实 ID，先报告限制，由宿主适配；不要拿随机值假装已绑定原会话。不要混入另一个 Agent 的会话环境。

以下 JSON 必须写入命令的标准输入（UTF-8）；结果在标准输出中：

| 命令 | 输入示例 |
| --- | --- |
| `node cz-iot-cli.mjs join` | `{"topic":"WorkBuddy 眼镜问答试用"}` |
| `node cz-iot-cli.mjs config` | `{"glasses_progress":false}` |
| `node cz-iot-cli.mjs ask` | 见下方 |
| `node cz-iot-cli.mjs wait` | `{"request_id":"使用 ask 返回的 ID","wait_seconds":30}` |

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

已配对电脑可使用 `node cz-iot-cli.mjs todo-add`，标准输入例如 `{"todo_key":"daily-2026-10-27-follow-up","content":"确认物料到货进度","source":"WorkBuddy"}`。它先向眼镜提出建议，用户确认后才由手机加入原厂待办。此命令及 `todo-status` 不需要当前聊天、`join` 或 Python，可用于已有的定时 Agent 任务。

保存返回的 `proposal_id`，以 `node cz-iot-cli.mjs todo-status` 和 `{"proposal_id":"返回的标识"}` 查询。同一 `todo_key` 重试保持原内容；`pending_confirmation`、`shown`、`accepted`、`creating` 都不表示创建完成，仅 `native_created: true` 表示手机报告原厂创建成功。`unknown` 时先核对原厂待办，不自动重投。参数、状态及手机前置条件见 [原厂待办 CLI 说明](rebuild/agent-bridge/questions/NATIVE-TODOS.md)。

## Codex 桌面更新兼容（0.2.3 起）

macOS Codex 原聊天用 `join` 输入 `{"control":"desktop"}` 接手机远程指令，按 `session-status` 的 `can_execute` 核对。CLI 不再检查桌面 App 版本或安装文件哈希：实际握手、原会话持有者的能力、设置和状态结构兼容就接入，不因正常 App 更新失效。接口真正变化或连接失败时仍明确报告，不新建聊天替代、不改全局启动配置。旧版提示 `CODEX_DESKTOP_VERSION_UNVERIFIED` 时先更新 CLI，再在原聊天重新 `join`，不用重新配对；已运行监听器等任务空闲后重启以加载新代码。

## 当前边界

- 此包连接的是已经运行的 Agent 会话。不会启动 WorkBuddy，也不能保证从手机远程唤醒、打断或恢复其进程。
- 进度推送默认按用户要求关闭；`notify` 不受这个开关控制，试用时不要连续发通知。
- 电脑配对后新会话无需再次扫码；配对可在长期离线后自动恢复短期凭据；服务器撤销绑定对应的设备后，续期和旧凭据都会失效。旧登记文件使用原有机制，不自动替换其他电脑。
- 这个 ZIP 不含已授权连接。手机需先登录原厂账号，并已有本项目的手机账号配对；此包不能自行创建服务器账号。
- 电脑授权默认保存在用户目录 ~/.turboio/agent-device.json，多个解压目录和 Agent 共用。显式 IO_AGENT_DEVICE_FILE / IO_AGENT_PAIRING_HOME 可隔离配置。旧单会话授权保持原有范围，不自动扩大。移到其他电脑需重新配对，不复制凭据。

## 验证包内容

`MANIFEST.json` 列出源提交和每个文件的 SHA-256。本包不含 APK、历史对话、录音、数据库、用户资料或访问密钥。`rebuild/agent-bridge/hermes/` 内仅为 CLI 复用的 Python 辅助代码，不会启动 Hermes。


## 可选：ACP 受管会话连接器

本包现包含 `node cz-iot-cli.mjs connector help`，电脑需使用 Node.js 22.18+。它通过显式配置的 ACP 子进程管理自己的会话；与上面给 WorkBuddy 原会话使用的问答 CLI 分开。不会替换桌面启动器，不接管已经打开的 Desktop 聊天。Claude/Codex 适配器需另行安装并固定版本；包内没有模型引擎或账号密钥。

初始化（JSON 从标准输入传入）：

```sh
node cz-iot-cli.mjs connector init --directory /absolute/private/connector
```

```json
{"runtime":"codex","label":"我的受管任务","workspace":"/absolute/workspace","command":["/absolute/node","/absolute/codex-acp/dist/index.js"]}
```

首次使用 `connector pair --directory ...` 生成电脑二维码/字符串，手机确认后用 `connector pair-status --directory ...` 领取授权。此后任何新 profile 直接 `connector run --directory ...`，共用这台电脑授权，无需再次扫码。已有正式电脑配对直接复用，也可显式使用 `run --device /absolute/private/device.json`。关闭该终端会退出连接器；后续 run 恢复已有受管上下文，不重发历史输入。初始化只保存配置；run 建立或恢复原生会话，首次提交任务才发起模型轮次。空会话可能不被原 Agent 持久保存。

工具权限由手机/眼镜选择“仅允许本次”或“拒绝本次”，不自动选择永久授权。通用 ACP 取消尚不能证明所有后台工作已停止，因此保持“停止未确认”，不承诺通用继续。本机 WorkBuddy 5.8.3 的内置 CLI 未完成 ACP 握手；官方独立 CodeBuddy CLI 2.177.0 已握手，创建会话需要登录，尚未完成真实执行。WorkBuddy 官方云端 ACP 另需要第三方应用授权，不包含在本包已验的本地 stdio 路径中。ACP 连接器已在 macOS 验证；Windows/Linux 端执行仍需分别验收。

受管会话的每轮手机任务都会获得 `IO_AGENT_CLI_ARGS`，直接运行 `notify / ask / wait / status`。命令固定绑定原 task、route 和 native turn，不创建替代任务，不再依赖 Python。工具沙箱内只写本地工作区 `.io-agent-cli` 邮箱，常驻连接器负责联网；不扩大 Agent 网络/文件权限。已结束轮次的命令会拒绝，等待同一 request 不重复投题。Agent 仍自行决定是否按任务调用 CLI，未执行命令不能算已投送；服务器保存也不等于镜片实际显示。

### 换手机恢复

在已经配对的电脑上运行：

```sh
printf '%s' '{"label":"新手机"}' | cz-iot-cli phone-recovery
```

新手机登录原账号，在「设置 → 手机与换机 → 输入恢复码」输入返回的一次性代码，然后选择「设为主手机」。代码10分钟有效，只能用一次；不用重绑每个Agent，不会撤销旧手机或改默认工作区。切换最多等20秒，旧进度不重播。此命令不需要当前session或Python；未配对电脑须先完成原有扫码/粘贴电脑配对。


2026-11-02：`daily` 已升级为已同步智记文字查询，指定日期自动收齐总结、分段与转写。新增 `daily-correct`、`daily-note`、`daily-history`、`daily-revert`；订正在服务器单独保存，不回写手机。原音仍不上传。以 `help` 和 `rebuild/agent-bridge/questions/DAILY-SUMMARIES.md` 为准。

### 智记订正文风（CLI 0.2.1 起）

订正前读取 `daily` / `daily-history` / `help` 中的 `correction_guidance`。每日总结与分段智记保留原日记口吻、叙述视角、标题和自然段节奏；事实优先，必要的删改与段落重组可以做。修改原因与依据放在 `reason` / `evidence`，正文不加入“订正版”或订正说明；不能仅凭 `speaker=others` 判定本人未参与。逐字转写保留说话人和原话结构，仅在用户授权时使用 `daily-note` 记录后续事实。

出现 `summary_stale` 时，优先保留本轮写入前的有效摘要，用 `daily-history` 核实最后有效稿及订正历史；`original` 是手机原文，不等于上一版已订正正文。结合有效转写修正并提交最新 `dependencies_version`，保留文风；提交后用 `daily` 回读确认。完整规则见 [智记查询与订正说明](rebuild/agent-bridge/questions/DAILY-SUMMARIES.md)。

CLI 0.2.2 同时要求分析和订正结合逐句 `blocks[].speaker`、时间与语境；合并 `text` 不带说话人标注。不要把 `others` 的讨论当成本人的工作或待办；`me`、`others` 是原厂识别标签，不明标签不猜归属。能访问且已获授权时，结合微信、飞书消息与项目背景核对人名、品牌、型号、日期和责任，阅读相关完整上下文；不能仅凭熟悉度、词频或搜索零命中改词。将消息/文档来源、时间及具体事实写进 `reason/evidence`，无法访问时如实说明。CLI 不包含微信/飞书查询，也不能通过文字订正修改结构化说话人标签。


2026-11-04：新增 `node cz-iot-cli.mjs daily-context`，stdin `{"date":"2026-10-30"}`。读取账号已同步的原厂已有活动、定位和日历，完整定位点仅在 `include_points:true` 时返回。`daily` 默认附结构化概览；没有原音、没有新增定位采集，日历不是实际出席记录。分页与来源限制见 `DAILY-SUMMARIES.md`。


## 更新 CLI（0.2.0 起）

```sh
node cz-iot-cli.mjs update --check
node cz-iot-cli.mjs update
```

已安装短命令时直接用 `cz-iot-cli update`。更新需 Git、已有的 Python3.10+ 环境。公开仓库可通过 `--https` 匿名读取，省略此参数时使用本机的 Git SSH 配置。不需要当前会话ID或手机连接。它只取 `codex/agent-workspace-ui` 通道中已经打包的 `docs/distribution/cz-iot-cli.zip`，不是直接运行未打包的开发源码。

先核对外层与逐文件SHA，检查拒绝损坏包和越界文件，再替换代码；保留 `~/.turboio`、`.io-agent`、`rebuild/agent-bridge/private` 及其他不在代码清单中的文件。普通文件替换错误会恢复本次已换代码；不要并发执行更新，断电中断后需重试。安装目录需当前用户可写，不自动提权或修改系统目录权限。

普通CLI下一次调用使用新版；已运行的受管连接器/会话监听器仍持有旧模块，需要等任务结束后重启。更新不会关闭用户的Agent。旧版不认识 update 时先手动换为0.2.0分发代码一次；不要删除原配对。返回 available:false 表示分发清单与已装代码一致，不需要重复更新。
