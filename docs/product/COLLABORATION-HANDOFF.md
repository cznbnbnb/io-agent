# GitHub 协作交接

**[codex] 2026-10-23 已迁入独立工作目录。** 已按用户指定脚本从 `origin/main` 建立 `codex/agent-workspace-ui`，工作目录 `../rayneo-io-agent-codex`，本轮 UI 提交为 `2d56d9b`（原目录落地提交 `12be672`）。迁移时两处文档冲突按 main 原文加本轮交接/A23-UI01 处理，未混入 Claude 设备代码。因 main 尚无新协作工具，本提交仅从 Claude 已提交的 `e0b4f09` 带入 AGENTS 协作约定及两个 `tools/collab` 脚本；补充共享私有材料的符号链接忽略项，工具文件与源提交一致，本地 SDK/签名/凭据/安装包只链接、不复制。未改 App、未装机（dev45 /10467 仅引用 Claude 交接）、未拿设备锁或使用测试身份。验证：工作目录和分支、共享链接、工具一致性、JS/脚本语法及差异格式；真人 UI 复评与真实设备功能仍待验。未推送。

**[codex] 2026-10-23 Agent 工作区 Web 原型与九条评审反馈。** 仅提交 `docs/prototypes/agent-workspace-v2/`、PRD、A23-UI01 验收待办和本条交接；App 未改、未装机、未操作设备或问答通道，装机版本沿用Claude 分支交接记录的 dev45 /10467，未由本轮实机核验。统一连接详情，补任务暂停/追加指示及回执、默认 Agent/工作区、固定列表高度、自动同步规则与开关、日历圆点、三天原音和文档导出、回到原厂 APP。检查：两份 JS 语法通过；浏览器点通上述流程并修复四处状态冲突，列表高 240 px 且切换位置保持。未验证：真人视觉评审、真实自动上传/导出、CLI 默认目标及眼镜主动唤起，均仍待实现或复评。

并行范围核对：已 fetch，读 `origin/claude/macos-toolchain` 最新 `e0b4f09` 和相对 `origin/main` 的差异；Claude 也改过 `USER-VERIFICATION-TODO.md`、本交接。此提交只追加本轮 A23-UI01 与本条记录，保留其历史。按用户要求先在现有目录提交，再用协作脚本从 `origin/main` 建 `codex/agent-workspace-ui` 独立目录并迁入本轮提交；不推送、不合并 main。后续设备操作先持 codex 锁，身份 caller600–799，后缀 `-<日期>-codex`，问题键 `codex-`。

更新于 2026-10-22，供另一位 AI 从当前代码基线开始工作。需求及顺序分别以 `PRD.md`、`DEVELOPMENT-PLAN.md` 为准；本文件不关闭尚未通过的验收出口。

## 当前基线

- Android 已装 **0.5.3-dev2 / 10424**，固定官方宿主 1.0.7 / 230；当前包 SHA-256 `fc1512040c6a4f3f87854388e1909e6139c37523ff5185fd5667ce9118401da9`。覆盖升级后登录、资料连接、schema3 账本及六个已存版本保持。
- **R2 80%、R3 60%、R4 50%** 为按交付出口的粗估。Android 成熟后才启动鸿蒙适配，不同时重写两套平台业务。
- 一分钟原生卡静置、旋转续时已经用户确认，原 PRD 两分钟阅读及其他正式门槛保留。
- 正常手机语音页完成一条 codex 合成路由：明确开始、144 帧 / 275200 字节 PCM、5 段最终识别，四项条件完整；停止回执、空闲及原生/采音/协调器释放通过。正常保存后服务器原问题的全文哈希、voice 来源、任务、问题版本及路由匹配。没有启动真实 Codex/Hermes 运行时。
- 智记真实正文及修订此前已同步服务器并回读；本版“按月份查找智记”实际返回三个日期，空选禁用及取消通过。**选中日期后的整段月发现同步未真机验完**。月份是日期线索，仍经按日 list→full→list 成员核对后入队；每批最多七天，空结果不删除。
- voice301 与 voice302 两轮合成任务已关闭，临时凭据已撤销并核对各角色 401；手机测试连接暂停、原 QA 默认目标恢复。守卫和驱动已移除，原音草稿留存。本轮优先级改为 GitHub 交接，第二次月份选择已取消并刷新，没有选择日期或发起月度导入。

本版还有一个低风险界面问题：取消月份选择后，旧“正在读取”文本可残留，刷新状态可清除；取消本身已执行。不要把提示残留解释成仍在同步或已上传。

## 证据入口

以下为可分享的摘要，不含真实正文、原音或令牌：

- `rebuild/android-app/normal-voice-delivery-2026-10-22.json`
- `rebuild/android-app/material-month-implementation-2026-10-22.json`
- `rebuild/android-app/phone-month-ui-2026-10-22.json`
- `rebuild/android-app/phone-month-dev2-install-2026-10-22.json`
- `rebuild/android-app/lifelog-calendar-core-test-results.json`
- `rebuild/android-app/lifelog-calendar-http-test-results.json`
- `rebuild/android-app/lifelog-month-discovery-test-results.json`
- `rebuild/android-app/material-month-runtime-test-results.json`

单月新增核心共有 636 项 JVM 检查，Android javac/D8 编译 168 份源码。服务器和物理证据分开记录；合成 tests 不证明实际眼镜效果。历史文档中的其他原始证据大多仅本地保留，仓库不存在相应路径不代表新的验收结论。

## 建议分工

| 所有者 | 可独立推进 | 需要先协调 |
| --- | --- | --- |
| 当前主代理 | 红米与眼镜、候选构建签名、OTA、真实账号资料核对、最终集成验收 | 设备独占、共享协议、同文件修改 |
| 协作 AI | 服务器/bridge、平台无关核心、恢复及幂等测试、代码审查、取消提示修复 | 正常语音和资料运行时若与主代理改同文件；任何真实设备/账号操作 |

每批在自己的分支提交 PR，说明目标、文件范围和实际测试。不要发送真实任务答案到替代会话，不根据测试身份猜测真实用户归属；不要直接执行旧设备诊断脚本。

## 下一批优先项

1. R4：完成正常月份选日同步及重复恢复核对，确认旧资料不丢、无重复执行；处理取消提示。随后调查增量刷新、原音映射和权威删除，日历缺失不能产生墓碑。
2. R3：将已验证的完整口述分别验到 Hermes、专用问答和真实 Codex/Hermes 原任务继续；保持停止/退出/占用交接与过期撤回保护。现有测试结果不能替代真实运行时接线。
3. R2 与日常稳定：补任务卡交接、断网及重启、锁屏后台和天气缺失，安排 8 小时佩戴与功耗验证。
4. 鸿蒙：等 Android 基础稳定、一分钟卡、三条主线及 8 小时门槛通过后，复用协议、状态机和样例适配平台接口。

人工项继续使用 `USER-VERIFICATION-TODO.md` 的 H14-R03、H07-V02 等稳定编号；开发未完成部分不要包装成用户待测。已确认且未受影响的旋钮/头势/一分钟卡不重测。

## 模块及测试

| 工作 | 主要文件 |
| --- | --- |
| 月历协议与解析 | `OfficialLifelogCalendarRequest.java`、`OfficialLifelogCalendar.java`、`OfficialLifelogMonthDiscovery.java` |
| 官方资料平台适配 | `Host107LifelogHttp.java`、`Host107Login.java`；认证只用于固定官方域名 |
| 资料生命周期及界面 | `MaterialRuntime.java`、`MaterialMonthWorkspace.java`、`MaterialWorkspace.java` |
| 资料来源与持久同步 | `OfficialLifelogDiscovery.java`、`MaterialSyncSession.java`、资料队列及修订日志 |
| 语音单所有者与停止 | `VoiceAnswerRuntime.java`、`VoiceAnswerCoordinator.java`、`Host107Recording.java`、归档/恢复核心 |
| 原问题提交 | `TaskRuntime.java`、`TaskHub.java`、`rebuild/agent-bridge/questions/` |
| 服务器与查询 | `rebuild/material-server/`、`rebuild/agent-bridge/`、`docs/contracts/` |

Java 文件位于 `rebuild/android-app/src/com/turboio/addon/`。使用 JDK17、Node22、Python3；本机 Python 可使用 `-B -S -X utf8`。

```powershell
node tools/android/test-lifelog-calendar-core.mjs
node tools/android/test-lifelog-calendar-http.mjs
node tools/android/test-lifelog-month-discovery.mjs
node tools/android/test-material-month-runtime.mjs
node tools/android/test-context-voice-fixture.mjs
node --test rebuild/agent-bridge/tests/*.test.mjs
```

资料服务器先按其 README 安装锁定依赖，再在自身目录运行 `npm test`。只跑受影响的检查，避免每次小改重做全量。HTTP 测试用替身端口，其中包含真实 30 秒截止；不需要真实账号。手机采音必须准备有效声源、当轮摆放确认、独立截止和停止核对。

## 未上传内容与权限

官方 APK、签名密钥、设备身份、真实凭据、用户录音/智记、SQLite、原始设备日志、构建工具及生成安装包均不在 GitHub。完整装包需在本地准备同哈希宿主和原自有签名，不能生成新签名后卸载旧 App 解决冲突。

用户此前对自有官网联调和调试手机的具体授权保留在本机项目约定中，但仓库访问并不授权另一运行环境使用真实身份或部署。正式资料凭据会到期，不得擅自无限续签。原始本地 Git 历史保留，远程使用审查后的独立基线；所有协作分支从远程 `main` 创建。
