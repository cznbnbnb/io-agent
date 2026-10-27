# 现有 Agent 会话控制

2026-10-27 更新：新增独立 stdio ACP 受管会话连接器，复用同一 CLI、配对、任务和结果链路；dev136 已装。Claude/Codex 的真实新建、同会话恢复、上下文和服务器结果已通过。用法及代价见 [ACP 接入说明](./acp-guide.md)。普通 Codex Desktop 原聊天接管仍未完成，造成启动协议故障的全局启动覆盖已停用；不再要求重启。既有 Claude 插件及显式 Codex 共享终端证据保留，见[常驻接入说明](./resident-guide.md)。

本目录按已批准的[实施计划](../../../docs/product/DEFAULT-AGENT-CONTROL-PLAN.md)开发。新增官方 Codex 共享 app-server 适配器、[Claude 原会话 Mod](./claude-mod/README.md)与耐久控制器；已开始真实引擎隔离验证。已新增手机任务分派/打断的源码接线与本机 HTTP 联调；尚未部署、装机或接眼镜主动入口。旧私有 Desktop 适配器的输入仍禁用，不能把新共享服务器的成功称为任意现有 Desktop 聊天已可热接管。

`codex-desktop.mjs` 通过已运行桌面的本机 Unix socket 找到原会话持有者，沿用其模型、工作目录和权限。不会另起 app-server、resume 同一会话、接管所有权或代答审批。私有协议只接受 `codex-desktop-profile.json` 核验过的安装源码；桌面更新后须重新核对，未知版本明确拒绝。

首次快照之后只保留会话/轮次元信息，接收连续修订补丁；旧对话正文、图片和工具输出不进入状态结果。监听断开、修订缺失或结构变化后，缓存不能用于执行。内部协议仍需接收一次完整快照，最大 256 MiB；超限拒绝。本批对当前长对话的实际只读验证得到 59 个已加载轮次、约 18 KiB 保留元信息，不等于实际控制验收。

从真实 Codex 对话运行只读检查：

```sh
node tools/collab/probe-codex-desktop.mjs
```

定向测试使用独立本机 Unix socket 和模拟桌面持有者，不会向真实对话发送输入：

```sh
node --test rebuild/agent-bridge/tests/codex-desktop.test.mjs rebuild/agent-bridge/tests/session-control.test.mjs
```

`start()` 始终拒绝，`atomic_idle_start:false`，没有 bypass 开关。一次或多次本地空闲检查无法防止桌面用户同时启动任务；`useUserMessageAdmission:true` 也可能 steer，整数组替换队列则可能覆盖用户并发添加的待办。已安装 CLI 有 `thread/queue/add`，但原持有者的安全可调用入口仍待接通。[具体证据](./codex-desktop-source-review-2026-10-25.md)。

`session-control.mjs` 复用现有 BridgeState 的 fsync/原子替换和 BridgeRunLock 的进程锁，固定服务器、账号、电脑、Agent、项目、session 与工作目录。新任务先入耐久队列；只有宿主明确支持原子空闲准入或原生追加队列时才可能发送，普通新输入不会 steer 当前任务。不同文件也不能取得同一原生 session 的第二个执行锁。发送前保存操作 ID；回执丢失或进程死亡后只查原操作，部分历史没找到仍是不明，不重发。确定未发的排队命令可取消/过期；已发送的操作到期仍须核对。继续指示限有停止证据的原任务、原会话，未发的继续指示取消/过期后可重新填写。

控制器现经 native-runtime 接 AgentBridge 和服务器控制事件；CLI 的 native_runtime 显式配置可启动该桥接，已在真实配对手机上用隔离 Claude/Codex session 验证办公与精确停止；最新继续结果以产品证据为准。合成宿主检查仍与真实引擎、手机验收分别记录。支持精确轮次的最终文字结果。声明 `final_result_evidence` 的宿主在终态之后仍须提供 `resultComplete:true`，缺最终结果时保留 `result_pending`、继续占用本会话队列，并只回查原操作；不生成第二轮补结果。未知结构不作为结果，明确空文本保留。电脑获得结果不等于手机已收到。

`interrupt(expectedTurnId)` 只向原持有者提交精确轮次的停止请求；原轮次不再活跃时不会发送。返回 `requested` 只代表宿主回执，`confirmedStopped` 始终为 false。控制器必须随后取得该轮次终态和受控子任务退出证据，才能显示 `stopped`。Claude 需精确工具账本、真实引擎身份与按轮次建立的独立进程观察同时成立；Codex 需完整实时轮次覆盖、原生命令终态及精确后台 handle 退出。未知工具、观察缺口或残留工作均保持 stop_unconfirmed。停止回执不明不重发；不将已退出的单个测试 PID 泛化为任意外部工作已停止。

Claude 已实现官方 Mod 候选，临时加载在真实2.1.308引擎的同一个 session 内；以后台 listener、`$.prompt.submit` 和精确 turn abort 工作。没有全局安装、修改模型供应商或接管当前用户聊天。原 Desktop 界面的加载和用户 Stop gate 仍须单独验收，早期[调查笔记](./claude-desktop-investigation.md)保留历史。


## 官方共享 app-server 候选

`codex-app-server.mjs` 只连接显式给定、已运行的服务器与已加载的具体 thread，核对原工作目录及直接输入能力。它不创建服务器、不更换模型或审批设置；由原持有者提供连接。显式 `subscribeEvents:true` 会在核对已加载原 thread 后，用无设置覆盖的 `thread/resume` 加入该 owner 的事件流，生产桥开启此选项；这不代表能自动接管任意 Desktop 聊天。Unix socket 必须是当前用户的私有目录内真实 socket，官方发布的符号链接由调用方先核对并取 canonical path。

```js
const host = await CodexAppServerSession.connect(nativeThreadId, {
  endpoint: canonicalUnixEndpoint,
  workspace: originalWorkspace
});
```

`start` 调用 `thread/queue/add`，固定 UUID 消息标识；按原生 userMessage.clientId 对账，排队项尚无 turnId，不捏造轮次。`startQueued` 指定本实例已记录的原 queueId 为首先启动的项，原生拒绝忙碌，不以 turn/start 替代。**它同时恢复后续队列执行，不是单任务隔离继续。** 2026-10-25 隔离实测：指定非队头 B，B 完成 34 ms 后原队头 A 自动启动，两项均完成，只有一次 queue/start。[证据](./codex-queue-selection-proof-2026-10-25.json)。生产控制器只在用户明确对已证实停止的原任务选择继续时接入此原子启动。手机会说明：继续也会恢复已有排队指令，具体顺序由原 Agent 管理。Codex 此接口的精确优先启动顺序已单独验证。启动前耐久保存意图，丢回执/重启不重发，不替换、删除或改序其它队列项。

中断后 `terminateTurnTerminals` 仅操作原终态 turn 的命令：历史或实时原生 item/started/completed 提供 item/process 关联，再与当前 backgroundTerminals 双重匹配；代码模式子工具可能不出现在历史重建结果中。停止意图只发一次，未知不重发；回执保留来源，仍不把 terminated:true 当作所有派生进程退出。

真实安装的 alpha 声明了分页 item API，但实际返回“不支持”；适配器仅对精确原生错误回退到同一 thread/read。新空 thread 的 not materialized 也仅在载入、空闲且确无历史时接受，通用失败不解释为空历史。

两个候选都声明 `native_queue_expiry:false`：本地未发任务和调用 native submit 前可检查期限，但原生队列中等待的输入目前不能保证执行时仍有效，也未提供已入原生队列任务的产品取消。不能将其包装成严格截止或完整手机控制能力。

## 有界真实验证

两个入口必须显式 `--live`，只创建本轮隔离 session/workspace，固定合成脚本和最大运行时间；不会发送到用户正在工作的聊天。使用现有模型配置与登录，独立限制测试工具；结束后清理自己启动的进程和临时插件，Codex 测试 thread 归档。失败收尾不计为原生停止成功。

```sh
node tools/collab/verify-codex-session.mjs --live --report /tmp/codex-proof.json
node tools/collab/verify-codex-session.mjs --live --interrupt-early yes --report /tmp/codex-early-proof.json
node tools/collab/verify-claude-mod.mjs --live --claude /absolute/path/to/claude --report /tmp/claude-proof.json
```

私有 report 可带合成 nonce、临时路径和诊断，不能上传真实历史或令牌。仓库证据只保留必要的合成会话标识、检查与版本摘要。Node 定向测试使用模拟宿主/真实本机 IPC，必须与这类真实引擎证据分开。


## 任务桥配置候选（2026-10-25）

`node rebuild/agent-bridge/cli.mjs run --config /absolute/private/bridge.json` 沿用原认证、inbox、耐久 outbox。私有配置中原有 `owner_id/producer_id/server_id/computer_id/agent_id/credential_file` 不变，新增以下字段；这里所有 ID 均为示例，必须由实际宿主登记返回的原 session 和工作区替换：

```json
{
  "native_runtime": {
    "state_file": "native/runtime.json",
    "sessions": [{
      "host_kind": "codex",
      "label": "本周讨论整理",
      "workspace": "/absolute/original/workspace",
      "route": {
        "computer_id": "registered-computer",
        "agent_id": "registered-codex",
        "project_id": "registered-project",
        "session_id": "10000000-0000-4000-8000-000000000001"
      },
      "endpoint": "unix:///absolute/private/app-server.sock"
    }]
  }
}
```

`label` 可选，用作手机显示的会话主题；去首尾空格后最多 64 个 UTF-16 单元、256 字节且不含控制符。未设置时显示 project_id。它不参与任务身份；修改后重启桥接，在新 acquire 时生效。route 前三项使用 1–128 位字母、数字、下划线、点或短横线；session_id 为小写标准 UUID。非法单项不会阻断其他会话续租。

Codex 必须由原持有者提供已运行的共享 app-server，原 thread 已载入。允许显式 loopback WebSocket；若服务器要求 bearer，配置 `auth_file` 指向仅含 `token` 的私有 JSON，不放 argv。目录首次探测或首个任务时连接；元数据探测不读取历史轮次，不提交输入。一次连接失败或断开后不暗中重建宿主，需恢复原端点后重启桥接。`status` 仍纯本地，不连接宿主或读令牌。

Claude 条目改用 `host_kind:"claude"` 和 `broker_directory:"native/claude-session"`，不带 endpoint/auth_file。启动桥接仅建立本地认证 broker，并在该私有目录生成临时 plugin；须由**对应原 session**按 [Mod 加载说明](./claude-mod/README.md)加载。此入口不会自动新建/resume session、安装全局插件、换模型或启动另一个 Claude 进程；未连接时任务只在本地等待。每个私有 bridge 配置只服务同一 computer/agent，session 集最多 32 个，不能和 `adapter_command` 同时设置。

桥接、runtime、SessionControl 三层账本必须一起保留。切换 route 集会拒绝沿用旧 cursor，避免新增 session 的旧任务被跳过。显式配置的原生宿主经一次配对身份登记目录；不扫描或自动接管其他会话。不能删除账本“修复”未知执行，也不能拿旧问答连接的已运行任务当作新任务执行。

### 会话目录与共享默认

新服务声明 `agent_session_directory_v1` 后，native bridge 独立发布已验证的 session 元信息。每 15 秒探测，服务端租约 60 秒；目录只展示真实宿主的绑定、工作区、忙闲和能力。一次探测最多 5 秒、4 路并发；准备发送时超过 15 秒的观察不能续租。宿主断开、控制器失锁、Bridge 阻塞都不会继续声称可执行。租约网络失败不阻塞既有问答和结果发送，退出只释放本实例租约，不停止原聊天。

问答 CLI 的 `join` 不会变成可执行 session，也不会自动设置默认。目录发布须用已配对电脑凭据，旧临时 mint 凭据不能冒充在线宿主。CLI 与手机共享 owner 下同一明确的四项 route；离线、过期或撤销后保留默认，不改投其他会话。

```sh
node rebuild/agent-bridge/cli.mjs sessions --config /absolute/private/bridge.json
node rebuild/agent-bridge/cli.mjs set-default --config /absolute/private/bridge.json --session 10000000-0000-4000-8000-000000000001
node rebuild/agent-bridge/cli.mjs clear-default --config /absolute/private/bridge.json
```

上面的 UUID 仅为格式示例。设默认仅选择该配置 computer/agent 下已存在且可执行的精确 session；三个命令均不会启动模型适配器。默认修改先保存独立私有 CAS 意图，丢回执后重用同一请求，不能覆盖另一设备后来保存的默认。原 ACK 和当前默认分别返回；凭据失效保留待对账记录。[接口合同](../../../docs/contracts/agent-session-directory-v1.md)。

### 手机控制与传输边界

遵循 [task-session-control-v1](../../../docs/contracts/task-session-control-v1.md)。服务器须声明能力；旧服务上手机明确禁用打断。新任务保持原四项 route；手机“打断任务”提交固定 command/turn 的 stop 请求，只有收到原生终态及子任务停止证明才开放“追加指示并继续”。停止请求 60 秒、继续请求 10 分钟；断网保留原事件与期限，不延长、不重投到新默认目标。

手机控制与电脑状态并发时，明确被服务拒绝的旧状态按新 control 精确收口，完成事实以新 revision 保留新 control，不更改已发送事件。已接受旧答案保留历史，停止后或命令变更后不再投递执行。结果先按 JSON 编码大小与字符双限拆分（240 KiB / 65536 字符），完整结果与完成状态同一耐久 runtime event，最多 64 actions；任一分片延迟时，同任务后续正文/完成/回执等待。其它任务可继续。

原生完整结果上限 1 MiB；native runtime 走同进程适配。原有 `AdapterHost` 的 stdio 帧上限仍 1 MiB，不用于转运这里的超长多分片事件。原问答连接与原生目录分别保留，目录过期不会封住旧问题的回答。生产宿主按上述可核验工作范围提供停止证明；任意未知/外部工作仍不放行。Codex 的已发送继续输入在原生队列中可见时，控制器仅对该 client ID 执行一次原子 queue/start，之后回查实际 turn 和最终结果。已发输入过期不能伪称已从原生队列删除；不会主动启动已过期指示。当前 App dev117 的继续说明与此语义一致，具体安装和验收结果见产品交接。
