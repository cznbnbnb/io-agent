# 新手机工作区执行恢复：2026-11-03（UTC 11-04）

本文前半为手机拔线时的电脑/服务器恢复记录；随后用户接回USB，dev168真机验证见文末。

## 已定位的两处故障

- Codex 手机工作区 `85ddd5a4-c238-4c3e-8a24-d5ef9cc04d30` 的正式服务因 `CODEX_DESKTOP_VERSION_UNVERIFIED` 退出。Desktop 升级后，原核对清单中的 bundle 名称和摘要失效。新独立 App 已恢复同账号配对，问题不在手机凭据。
- Claude 原桌面续接会话 `bfae0b25-5c1a-49ef-bed9-ef98a47c3e3d` 仍在线，但 10 月 29 日的一轮本地观察残留 `outcome_unknown`。它让后续手机任务一直处于 `waiting_for_observed_turn`，即使原生会话已空闲也不能派发。

Claude 修复只在同一个原生 host 明确回报 `busy=false` 且 `activeTurnId=null` 时，不再让没有 Stop 操作的历史未知观察阻塞新指令。旧事实仍为未知，不补造完成回执；远程已发送但结果不明的任务、未证实的 Stop 仍保留阻塞。

## Desktop 版本核对

本机 `/Applications/ChatGPT.app`：`CFBundleShortVersionString=26.1023.50603`，`CFBundleVersion=22391`。只读解析 `Contents/Resources/app.asar`；未改安装包、启动环境、模型设置、桌面会话所有权。

完整路径、字节数及 SHA-256 写入 `rebuild/agent-bridge/hosts/codex-desktop-profile.json`。此次保持精确版本校验，没有关闭 pin：

| Bundle | 已核对内容 |
| --- | --- |
| `.vite/build/src-tOjGKoT3.js` | follower 方法版本、owner 发现、精确 host/conversation 路由、stream 分发 |
| `.vite/build/main-UOTY8NmV.js` | 主进程入口与 follower IPC 接线 |
| `.vite/build/application-network-startup-DMyt3FBI.js` | 应用启动接线 |
| `webview/assets/app-initial-b539f0af92f3.js` | start/read-settings/steer/interrupt/settings handler、原始用户输入、隐式上下文、timeline 广播 |

方法版本未改变：owner-discovery 1、read-model-settings 1、start-turn 2、interrupt-turn 4、following-changed 1、state-changed 11、steer-turn 1、update-thread-settings 2。没有新增字段映射或修改请求格式。

本次摘取文件中可复核的文本位置（约数）：`src` 方法表 6000、owner handler 758978；webview interrupt 2815264、start 2816214、steer 2816358、read-settings 2816640、settings 2817330、原生 start 3086780、stream broadcast 3282527。位置仅作复核索引，适配仍靠整文件摘要校验。

## 只读及真实回执证据

- 当前开发聊天 `01a1670e-97c8-7083-a014-aa9ea3de6a98`：只读 owner 连接成功，原生 cwd 为 `/Users/cznbnb/Project/AI Glasses Project`，正在运行；未发消息、未中断。
- 85ddd5 对应原生聊天 `01a17d09-d939-78b1-ac2e-d601a8f7a544`：首次检查 owner 未加载。由主代理使用正式 Desktop 工具打开这条既有聊天后，只读检查得到 `busy=false`、`activeTurnId=null`、上一轮 completed，cwd 与 `/Users/cznbnb/Documents/iO Agent/Codex` 一致。主代理随后更新正式 runtime 的 profile 并启动原 connector；服务器已回报 online/can_execute。
- 主代理随后向 85ddd5 下发合成短任务 `task-codex-recovery-a714aad2-d79e-46d3-8b43-030d4e057016`。同一原生聊天完成 turn `01a1a4c4-812e-75b0-9ea8-577845c89e7f`，三阶段回执齐全；result message `result-ae734a2b5af668535c4a60b5275c3d2e2401d8023ca2b79bc50a712dbb03752f` 已 ACK，正文 13 字符，SHA-256 为 `4d98a5979361973dbbc1c6848d9f0c9d29ba31396956098ce54baf151bf6a6bd`。
- Claude 原手机测试 `task-android-6ae97210e92d97172a09dcae7af2e74545b5797f42cf10c02eb8685eb48f2dea` 没有重新提交。主代理部署修复并按原私有配置重启 listener 后，原队列自然派发，原生 turn 为 `f728cc0b-9ab3-431a-9ff8-f5a8c8ce7e1c`，完成于 `2026-11-04T04:14:39.883Z`。
- Claude 最终文本通过独立 result message `result-f8f35827b5ad73d064897a037b40d2be011307ceec173aa983c206fa438a3642` 发送，正文长度 1，主代理核对服务器任务 revision 5 与 agent_received/task_resumed/task_completed。任务对象的 `body.result` 为空不等于没有回复；应读取关联 message。

## 当前聊天接入方式

`join` 新增显式参数：

```json
{"topic":"iO Agent 开发与维护","control":"desktop","pairing":"computer"}
```

- `control:desktop` 只跟随宿主提供的当前 `CODEX_THREAD_ID`。只读校验已有 owner 并使用其真实 cwd，不创建、不恢复另一条聊天，也不启动另一模型进程。
- `pairing:computer` 复用已经配对的电脑凭据；从旧 scoped 凭据切换前必须是同 owner、同 server。原生 session ID 不变，目录 route 按真实 cwd 登记；不会修改旧 route 的不可变 workspace。
- 切换前先 `leave` 旧 listener 并确认退出。旧登记和历史保留，旧答案不转移；未消费答案/待答问题继续沿用现有迁移拒绝规则。
- 接入方式保存在私有登记中；后续 `join`、`session-status`、`leave` 可以保持同一路径。输入使用现有 Desktop shared host，忙时排队，不注入 `CODEX_CLI_PATH` 或修改全局启动设置。

## 验证

- `session-control`、`native-runtime`、`claude-mod`：122 项通过，含历史观察恢复及远程未知操作继续阻塞。
- 原 CLI join/ask/wait、Desktop、resident、待办命令及新迁移验证：36 项通过。
- 迁移测试使用隔离 loopback 服务器、合成 owner/session、假的只读 Desktop owner；未触碰真实 Desktop socket，未启动 listener。不同账号/服务器在发布任何任务前拒绝，重复 join 保持同任务及同原生 session。

后续 Desktop 再升级仍会触发版本核对，需复核新 bundle；不能把该私有 follower 接口描述成官方稳定 API。

## 后续真机发现：忙碌的当前聊天被误归类

主代理安装 dev167 并打开真机连接页时，已实际看到三个“可接收任务”会话：Claude 原聊天续接、Claude 手机工作区、Codex 85ddd5 手机工作区。当前开发聊天因 busy 被误归入“离线与未就绪”。`2026-11-04T04:49Z` 的只读核对结果：

- 当前聊天的新 listener PID 54367 正常存活；正式目录 route 为 `io-mac-computer / io-current-codex / workspace-2c2bf72fb7add79e3cf410ec / 01a1670e-97c8-7083-a014-aa9ea3de6a98`。
- health 新鲜，`cloud_online=true`、`can_execute=true`、无错误。服务器同样回报 online/can_execute，另有 `busy=true`、`atomic_queue_append=false`。
- 旧 scoped listener 已停，目录仍保留其历史离线条目。服务器共有 8 个条目，手机登记上限 16；不是容量问题。

原因是手机 `TaskSessionDirectory.Entry.gate()` 旧实现额外拒绝了 `busy && !atomic_queue_append`。这里的 `atomic_queue_append` 只描述能否原子追加到原生 Agent 队列；Desktop 使用电脑 listener 的持久队列等待原会话空闲，因此此值正确地为 false，不能为了让界面可选而伪造 true。

`NativeRuntimeAdapter.readinessSnapshot()` 已统一给出是否接受任务的结果：原生队列或 `shared_conversation_input` 可以在忙碌时公布 `can_execute=true`；纯 `atomic_idle_start` host 忙碌时公布 false。dev168 已据此修改手机 gate：在新鲜在线租约下信任 `can_execute`，忙碌会话显示“忙碌 · 可排队”，仍保留原生 `atomic_queue_append=false`。相关四组回归检查分别为 143、98、68、41 项，全部通过；只读复核未发现遗漏或回归。

只读复核了提交到执行的完整路径，没有发现另一处以 busy 拒收 Desktop 任务的判断：

1. `TaskWorkspace.DelegateForm.available()/submit()`、`TaskRuntime.delegate()`、`TaskHub.delegate()` 走同一目录 gate/requireExecutable，随后持久保存手机任务。源码中没有独立 `TaskDispatch` 类，这几层就是实际下发入口。
2. `TaskApi.pump()` 在 claim 及发送前再次调用同一 `TaskSessionDirectory.gate()`；不会另行解释 busy。修 gate 会同时覆盖首次提交、发件箱等待目标及 POST 前复核。既有任务仍以原 operation ID 对账，不改投其他会话。
3. 服务器 `POST /v1/tasks → queueSubmit() → queueApply()` 校验身份、scope、路由、时间、幂等及 revision；不会按忙碌状态拒收。服务器设置默认目标同样只判断 online 与 can_execute。
4. 电脑 `NativeRuntimeAdapter.onItem()` 接受匹配路由的新 queued revision，写入持久 journal 并发出 agent_received；`pollEvents()` 将指令放进 `SessionControl`。Desktop 忙碌时 `tick()` 保持 `queued / waiting_for_idle`，空闲才开始原生输入；这属于正常排队，没有失败或换会话。
5. 已通过的 `session-control.test.mjs` 中 “shared desktop owner explicitly admits same-session messages after busy desktop work ends” 覆盖：busy 时零次原生输入，空闲后只派发一次并进入 running。

本次仅复核现有代码、状态并补本文档；没有向仍在工作的当前聊天发送新的真实任务。真机呈现及提交入口由主代理继续验收。

## 当前开发聊天实际接入

主代理已停止旧 scoped listener，使用原配对电脑执行显式 Desktop join，原生 session `01a1670e-97c8-7083-a014-aa9ea3de6a98` 保持不变。新 route 使用真实原生 cwd `/Users/cznbnb/Project/AI Glasses Project`，project `workspace-2c2bf72fb7add79e3cf410ec`；旧 worktree route 保留历史且已离线，不双重消费。2026-11-04T04:22:43Z 服务器确认新 route online/can_execute/exact_turn_interrupt 均为 true。当前聊天正在开发，未向它人为重复注入一轮；忙时队列由既有协议测试覆盖。眼镜进度开关明确为 false，服务器 watch 已关闭。

正式 runtime 已同步本批 profile、session-control、resident-manager、session-resident、questions/cli；Claude 所需 broker/plugin register 也按已提交版本补齐。Codex 手机工作区服务及 Claude 原聊天 listener 保留运行。默认目标仍为原 85ddd5 工作区，没有擅自替换用户默认。手机离线期间仅核验服务器与原生聊天，不把这作为手机页面验收。

## 手机交付状态

- 手机重新接入后，dev167 的三个可接收工作区已完成页面检查；主手机也已通过正常确认流程切换到独立包 `cn.cznbnb.ioagent`。
- dev168 的 busy gate 修复已完成构建、上述回归和差异安装，手机页面验证如下。
- 当前 busy 聊天未重复注入新任务；页面可排队与既有队列测试分别记录，不宣称本轮重新完成了手机到当前聊天的实际派发。

### dev168 真机复核

2026-11-04T05:00Z，dev168/10590差异安装与完整SHA核对通过。设置页显示4个可接收；当前开发聊天显示“忙碌 · 可排队”，与3个原可用工作区共同列在可接收组。默认仍是85ddd5，旧route仍离线。当前聊天仍在工作，未人为重复注入新任务；实际排队执行沿用已通过的完整路径测试。
