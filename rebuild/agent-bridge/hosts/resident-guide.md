# 会话常驻在线与手机控制

2026-10-27：普通 CLI 接入升级，手机 dev134 /10556，回退 dev133。最新验收见 [交付证据](session-resident-proof-2026-10-27.json)。此前 dev117 是显式装配隔离宿主的验证，不能代替本次普通会话接入。

## 接入方式

电脑先完成一次账号配对；当前真实会话运行 `questions/cli.mjs pair`，手机扫码或粘贴配对字符串保存，再运行 `join`。已有本机配对仍可复用。会话 ID 来自原生宿主环境，不在 JSON 中手填，不能借其它聊天的 ID。

每台 Mac 首次使用需要安装一次宿主接入：

```sh
# 默认只读预览，不改配置
node tools/collab/setup-session-control.mjs --codex --desktop-app /Applications/ChatGPT.app
# 用户已授权的实际安装
node tools/collab/setup-session-control.mjs --codex --desktop-app /Applications/ChatGPT.app --apply
```

Claude 安装用户级本地插件 `io-agent-session-bridge@io-agent-local`。新会话自动加载；已开的会话需正常 `/reload-plugins` 或重新打开。未 join 的会话只检查本机登记，不连接服务器、不提交输入。

Codex 使用版本匹配的官方共享 app-server。setup 启动或复用本机 daemon，并为之后启动的桌面进程设置 `CODEX_APP_SERVER_USE_LOCAL_DAEMON=1`。当前已经运行的 stdio owner 不能热迁移；需用户正常重启桌面一次。不会强制关掉用户聊天。该桌面开关来自当前安装源码，按版本和源码 SHA 核验，升级后需重新确认兼容性。

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

当前主 Codex Desktop 聊天仍由旧 stdio owner 持有，显示 `CODEX_SESSION_NOT_LOADED`、执行关闭；这部分等待正常重启后验收，不能称作当前聊天已可被手机打断。眼镜双击主动唤起尚未接线，不从手机通过推定眼镜通过。

每个接入会话多一个 Node 监听进程。本机空闲样本约 68 MiB RSS、1.2% CPU（单次采样），会持续轮询并续租；电脑需联网且醒着。空闲监听不调用模型、不消耗推理 token，执行手机指示按原 Agent 正常计费/扣额度。Claude 正常重载可能重建提示缓存。插件和 daemon 接口升级会有维护成本。

真实发现：Codex 长时间同步工具调用可能不暴露可终止的后台句柄，`turn/interrupt` 能停模型，但其命令仍可能运行到自己的截止。此时保持“停止未确认”，禁止继续该任务，不猜 PID、不清空整个会话终端。常规已返回句柄的后台命令路径已通过。旧的未确认历史不会伪改为成功；后续另一个已证明停止的任务可按其自己的明确继续指示推进。

回滚接入设置：

```sh
node tools/collab/setup-session-control.mjs --rollback --apply
```

仅撤下本工具登记的插件/目录配置并恢复原启动环境值，保留会话数据和官方 daemon。需要先用 `leave` 停止自己会话的监听；不删除用户聊天、凭据或工作文件。
