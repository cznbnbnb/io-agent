# 会话常驻在线与手机控制

2026-10-27 故障纠正：此前 Desktop 转接器导致真实 App 启动时 `policy-read reason=protocol`，已停用。用户移除覆盖后恢复；当前自带原生 Codex 启动成功。本工具不会再安装 Desktop 启动覆盖，也不要求再次重启。组件/Unix 双连接测试没有覆盖真实 Desktop 的组织策略启动流程，不能据此称作兼容。[恢复和停用证据](desktop-relay-withdrawal-2026-10-27.json)。

2026-10-27：普通 CLI 接入升级，手机 dev134 /10556，回退 dev133。最新验收见 [交付证据](session-resident-proof-2026-10-27.json)。此前 dev117 是显式装配隔离宿主的验证，不能代替本次普通会话接入。

## 接入方式

电脑先完成一次账号配对；当前真实会话运行 `questions/cli.mjs pair`，手机扫码或粘贴配对字符串保存，再运行 `join`。已有本机配对仍可复用。会话 ID 来自原生宿主环境，不在 JSON 中手填，不能借其它聊天的 ID。

Claude 每台 Mac 首次使用安装一次宿主接入：

```sh
# 默认只读预览；--apply 安装用户级 Claude 插件
node tools/collab/setup-session-control.mjs
node tools/collab/setup-session-control.mjs --apply
```

Claude 安装用户级本地插件 `io-agent-session-bridge@io-agent-local`。新会话自动加载；已开的会话需正常 `/reload-plugins` 或重新打开。未 join 的会话只检查本机登记，不连接服务器、不提交输入。

Codex Desktop 原聊天接管尚未完成。禁止设置全局 `CODEX_CLI_PATH` 或 `CODEX_APP_SERVER_USE_LOCAL_DAEMON` 来绕过这个缺口；旧 Desktop 安装参数在本版脚本中返回 `SETUP_CODEX_DESKTOP_DISABLED`。原 App 使用自己的原生引擎和组织策略检查。普通 CLI 显式 `--remote unix://` 是单独已验证的共享终端路径，不代表 Desktop 原聊天可控制，也不自动迁移聊天。

如果本机之前装过 Desktop 集成，只停用这一项：

```sh
node tools/collab/setup-session-control.mjs --disable-codex --apply
```

命令仅移除本工具仍在使用的启动覆盖；已经由用户清除的值保持为空，外部替换和原来已存在的值不覆盖。Claude 插件、配对、会话数据和原生 daemon 保留，不结束日常 App。安装记录会标记 disabled。

在原生会话内调用：

```sh
printf '%s' '{"topic":"本次任务主题"}' | node rebuild/agent-bridge/questions/cli.mjs join
printf '%s' '{}' | node rebuild/agent-bridge/questions/cli.mjs session-status
# 只退出本会话的 iO 控制，不杀 Agent 或其工作
printf '%s' '{}' | node rebuild/agent-bridge/questions/cli.mjs leave
```

join 自动启动一个本机 Node 监听进程，重复 join 复用它。文件位于用户私有的 `~/.turboio/session-control/sessions/`。普通 Codex 沙箱可能需要对这条 CLI 命令作一次正常批准，以访问私有配对状态和网络；不修改全局审批、沙箱或模型设置。缺组件、宿主未加载、需要重载均明确返回原因，不能把 `joined:true` 当成 `can_execute:true`。

WorkBuddy ZIP 仍是跨电脑问答包；不包含常驻宿主组件，也不宣称支持远程执行/打断 WorkBuddy。Windows 常驻未支持，问答链不受影响。

## 手机看到什么

- 已配对且监听运行时可显示在线；宿主尚待重载/重启时保留在线和具体原因，执行能力关闭。
- 原来只有主题的条目是会话问答登记。普通电脑本地任务会另外显示“会话执行 · 主题”，只有真实原生 turn 才提供打断入口。旧登记可跳转到同会话唯一的当前执行任务。
- 打断只发给对应的原 turn。须收到轮次终态和受控后台工作退出证据，手机才能显示“已停止，可追加指示继续”。
- 追加继续回原 session、原 task，沿用上下文。继续也会恢复该会话已有队列，具体顺序由原 Agent 管理。
- 同电脑多个会话和短时问答桥可以并行；同一控制范围仍独占，旧的广域桥与这些窄域桥仍互斥。
- 原生会话结束/归档或真正的宿主退出后下线。共享 daemon 模式的 Codex `/quit` 只是断开终端，后台会话仍存在；可用 CLI `leave` 明确退出 iO 控制，归档原生会话也会自动下线。

## 实测范围、代价与限制

普通全局 Claude 插件会话、普通 Codex `--remote unix://` 终端会话均完成真实文档写入、手机精确打断、父子进程提前退出、追加修改原文件预算 8000→9000、保留原上下文及结果回手机。没有使用临时 `--plugin-dir` 或手写宿主连接文件来替代日常接入。

当前 Desktop 使用原始 stdio owner，手机下发/打断原聊天的能力仍未完成。真实启动失败后已撤回转接路线；后续兼容性研究须先在隔离 App/配置验证组织策略加载、工具和退出，再考虑用户日常环境。不能用原生协议单测、相同版本或创建另一个引擎代替验收。眼镜双击主动唤起尚未接线，不从手机通过推定眼镜通过。

每个已接入会话有一个 Node 监听进程。本机空闲样本约 68 MiB RSS、1.2% CPU（单次采样），会持续轮询并续租；电脑需联网且醒着。空闲监听不调用模型、不消耗推理 token，执行手机指示按原 Agent 正常计费/扣额度。Claude 正常重载可能重建提示缓存。已停用的 Desktop 转接器不再从 App 启动，也不再增加其约58MiB的转接进程。插件和原生接口升级仍有维护成本。

真实发现：Codex 长时间同步工具调用可能不暴露可终止的后台句柄，`turn/interrupt` 能停模型，但其命令仍可能运行到自己的截止。此时保持“停止未确认”，禁止继续该任务，不猜 PID、不清空整个会话终端。常规已返回句柄的后台命令路径已通过。旧的未确认历史不会伪改为成功；后续另一个已证明停止的任务可按其自己的明确继续指示推进。

回滚接入设置：

```sh
node tools/collab/setup-session-control.mjs --rollback --apply
```

此完整回滚还会撤下 Claude 插件；若只处理 Desktop，使用上面的 `--disable-codex --apply`。旧版本记录尚未停用时，完整回滚仍可恢复其原环境；已经标 disabled 的覆盖不会再恢复。保留会话数据和官方 daemon，不删除用户聊天、凭据或工作文件。

## 掉线排查（2026-10-29）

- owner/worker与停止观察的出生身份采用固定UTC/C语言的ps输出。时区、语言变化不代表进程重启；不更改系统或会话时区。升级前的本地日期记录需在原时区核对出生身份后重建监听，不能只认PID。
- 手机显示的名称可能属于较早的session。Claude Desktop续接会产生新native ID，须以真实桌面映射核对当前会话；旧输入、旧问题和旧停止命令不搬到新ID。
- 受管连接器的暂时网络/429/5xx错误在原进程内退避重试（1–15秒；明确重试等待最长30秒），保留ACP进程与持久队列。认证、身份、状态账本和成功响应的协议错误仍失败退出。日志以UTC记录connection_retry/connection_recovered及错误码，不写模型凭据。服务器60秒在线租约不变；实际长断网、睡眠或原生会话结束仍会离线。
- 修复不需要更新APK或修改Desktop全局启动变量。当前正在运行的原生会话可只重建自有监听；受管服务更新须先核对无活动/结果不明轮次，再通过connector-service停止/启动，确认仍加载相同native session。
