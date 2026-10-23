# GitHub 协作交接

**2026-10-22（PDT；UTC 10-23）当前装机 dev36 /10458，回退 dev35。熄屏口述闭环已真人通过。** 手机 HOME 后熄屏，23 次电源采样均为 Dozing；眼镜长按退出提词器 → 自动口述 → 眼镜结束 → 确认卡提交 → 当前 Codex 原对话收到完整原话和 `option_id=ok`。录音停止/资源释放、服务器全文回读、一次消费/继续和重复领取去重均通过。dev35 首轮发现 Codex 电脑标识过长导致确认卡拒发；dev36 仅缩短卡片标题显示，原路由和全文保留。本轮测试任务已完成，连接暂停，三类短期凭据撤销并核对 401；原音/草稿保留。通知到来时不遮挡、Activity 销毁后的无界面分支及 8 小时运行仍待验证。[证据](../../rebuild/android-app/phone-screen-off-dev36-2026-10-23.json)。

**2026-10-22 当前真人口述更新：真实当前 Codex 原任务已继续并完成。** 本人佩戴眼镜回答，经手机核对保存，原 CLI 在当前对话收到完整答案；实际按要求生成[眼镜语音验收记录](./眼镜语音验收记录-2026-10-22.md)并列出根目录。一次消费、一次 task_resumed、一次 task_completed，重复领取命中同一答案。测试连接已暂停，三类临时凭据撤销并验证401；记录正文只存本地，未推送。当前 App 仍 dev8 /10430。Hermes 真实原任务、完整镜片交互及前后台/锁屏恢复仍待验证；曾需重开App恢复同步，且完成后留有旧“等待回答”标签，不能算已修复。[证据](../../rebuild/android-app/current-codex-voice-2026-10-22.json)。

**2026-10-23 熄屏/后台口述与通知不盖任务弹窗（dev35 /10457，回退 dev34），真机只验到“熄屏后问题照常上提词器”。** [证据](../../rebuild/android-app/phone-background-dev35-2026-10-23.json)。
- “眼镜任务卡”页新开关“熄屏或App在后台时也在眼镜提问、口述并确认”（默认开）。任务轮询、任务卡、头势保护、口述不再只认前台；后台每10秒查新问题，任务交互中3秒。App页面已关闭时，眼镜发起的口述由无界面流程完成（自动开始 → 眼镜上结束或60秒 → 确认卡 → 保存），没确认的草稿留在手机。
- 任务提词器、任务卡或任务口述在镜片上时，原厂普通通知正文（21/type2）不发到眼镜，手机上照常保留；自有任务卡、通知状态帧、建议卡不受影响。持有方按租约续期，超时自动放开。
- dev34 缺陷：卡片持有用了 `cardMayExist()`（退场未证实前一直为真），提词器结束后通知一直被挡；dev35 改为只在卡片实际进行中持有，空闲时读回为空。
- 待用户：两次熄屏提问都到了提词器，但都没长按、3分钟自动退出，熄屏口述/确认/保存及口述期间来通知尚未真机验证。测试身份 caller312/313 已关闭任务、撤销并验证 401。

**2026-10-23 Claude Code 当前会话经眼镜完整回传 3 次（dev33 /10455，回退 dev32）。** 提词器 → 长按退出 → 口述 → 确认卡 → 服务器 → 本会话 CLI `wait` 收到完整原话和 `option_id`。[证据](../../rebuild/android-app/phone-keep-dev33-2026-10-23.json)。
- dev27：任务提词器显示满 3 分钟自动退出。dev28：提词稿开头显示 Agent 登记的对话主题（用户口述选定）；`prepare-current-caller.mjs --topic`、CLI 登记 `topic` 可选，单行不超过 40 字。
- dev29–31：口述确认卡可选点头提交/摇头留手机（“眼镜任务卡”页开关，默认关；其他卡仍只认按键）。电脑任务页当前会话置顶，其他会话和已结束项折叠。加了 `TurboIOCard`/`TurboIOVoice` 计时日志。
- dev32/dev33：录音缓冲按 60 秒上限加 4 秒分配（原 32 秒，35 秒的回答报 `VOICE_RECORDING_RANGE_INVALID`）；任何正常停止都保留未定稿的末句进入核对，不再整段“不完整”。
- 头势探测：请用户读题时摇两下头，任务提词和任务口述期间都没有收到任何头势信号，“摇两下头退出”走不通。
- 熄屏/后台口述与通知遮挡已在上方 dev35 处理。测试身份 caller309–311 已关闭任务、暂停连接、撤销并验证 401。

**2026-10-23 提问 CLI 支持任意 Agent；Claude Code 当前会话真机提问（dev26 /10448，回退 dev25）。** [证据](../../rebuild/android-app/phone-background-dev26-2026-10-23.json)。
- CLI：调用方由宿主环境恰好一个来源确定：Codex `CODEX_THREAD_ID`、Claude Code `CLAUDE_CODE_SESSION_ID`、其他 Agent 由宿主设 `IO_AGENT_CALLER_RUNTIME`/`IO_AGENT_CALLER_SESSION`；多个来源同时出现时拒绝。Codex 原目录和 ID 不变。`wait_seconds` 最多 600 秒，等待截止后再留 10 秒给最后一次轮询，修复了结束时误报 `NETWORK_UNAVAILABLE`。skill 已装到 `~/.claude/skills/turboio-ask-user`。
- dev22：用户否决两项分页卡，所有选择题都走提词器；提词稿开头写 Agent、项目、会话前 8 位（用户说不要写“会话”，想要的写法还没问到）。
- dev23：type9 是眼镜音频上行，不再当成退出。
- dev24/dev25：口述上限改为 60 秒（用户要求）；到点截停时已说内容进入核对和确认卡，不再整段卡在“不完整”。合成采音实验仍按 AGENTS.md 的 30 秒执行。
- dev26：根因是 App 退到后台（装完重启、熄屏）时上游 `MusicPlayer.background` 调 `NewsTele.stop`，提词在准备/就绪阶段被关，眼镜报“未知错误”。Agent 问题的提词稿现在保持到佩戴者退出；熄屏验证通过。
- 未完成：佩戴者退出后要自动口述，仍需手机亮屏且 App 在前台；两道真机问题都没有答案到服务器（第一道被 30 秒截断，第二道到期未操作）。测试身份 `caller308-20261022-a` 已关闭任务、暂停连接、撤销凭据并验证 401。

**2026-10-23 长问题闭环真机通过（dev21 /10443，回退 dev20）：合成 4 项选择题自动上提词器 → 长按退出 → 自动口述 → 眼镜确认卡按＋ → 服务器收到 `option_id=readme` 和完整原话。** [证据](../../rebuild/android-app/phone-route-dev21-2026-10-23.json)。
- dev19：dev13 起卡片运行时一直是 `BLOCKED`。原因是存着 dev12 长度探测留下的 60–120 字卡片记录，按新的 48 字上限恢复失败。现在恢复时只核对结构，不再核对旧文字长度；新卡显示时仍按上限检查。
- dev20：提词器启动成功后才把问题记为“已提示”。眼镜还在连接时启动被拒，会在 10 秒后自动重试。
- dev21：官方访问令牌过期时报 `OFFICIAL_LOGIN_REQUIRED`（“官方账号登录已过期”），不再显示成“连接已暂停”；打开官方 App 任一页面即可刷新令牌。确认卡被拒时，语音页说明原因并每 3 秒重试，不再声称已发到眼镜。
- 测试身份 `route313-20261023-a`：3 个任务已关闭，手机会话已暂停，凭据已撤销，两个身份都返回 401。未核对镜片上确认卡的具体文字；没有真实 Agent 读取这次的答案。

**2026-10-22 问题分流（dev18 /10440，代码说明；真机结果见上方 dev21）：长问题自动走提词器，退出后口述，选择题按口述选项号作答。**
- **分流规则**（`AgentCardRequest.route`，CLI 的 `glasses_display` 与之镜像，两边测试用同一组例子）：一行的 `free_text` 不超过 36 字，或两项选择题每页不超过 48 字 → `card`；其余（3–4 项、长文字、多行）→ `prompter`。`prepare()` 对提词器问题返回 `TASK_GLASS_PROMPTER`，旧的分页卡记录仍可恢复和翻页。
- **提词器路径**：自动或手动入口都会把整题和编号选项发到提词器（速度 120），稿件末尾提示“看完长按退出，然后说‘选几’”。只有佩戴者长按退出（type6 action1）才触发交接：手机打开该问题的语音页，并按眼镜发起的方式自动开始采音；手机停止或失败都不触发。
- **选项映射**（`VoiceOption`）：“选二 / 选择3 / 第四项 / 开头说 2 号”等只取唯一的选项号；“不选二，选三”、“第一步…”、“选一下”都不算。保存时从冻结文字推出 `option_id`，同一文字重放结果相同；完整原话作为 `text` 保留。没听出唯一选项号时 `option_id` 为空。
- **确认卡**：选择题口述后显示“选2：选项文字”，放不下就显示“选第2项”，有补充时加“；另有补充”；没识别出选项号则显示原话。＋仍只交回手机核对后保存。
- **CLI**：`ask`/`wait`/`status` 回包新增 `glasses_display`，工具说明和 `turboio-ask-user` skill 已同步。
- 测试：卡片 759 项、语音 1908 项、上下文 47 项、提词传稿 18 项；Hermes 109 项（需 Python 3.11+，本机用 `.runtime/hermes-agent/.venv`）、问答 9 项、Node 79 项。
- **待真机**：提词器退出后语音预检能否立即通过（眼镜可能还在离开提词器）；自动入口的时机；确认卡与保存全链路；真实 Agent 读取 `glasses_display` 与 `option_id`。提词器显示期间问题在手机被回答或关闭时，提词器不会自动退出。

**2026-10-22 安卓提词长问题更新（dev17 /10439，回退 dev16）：合成长问题经提词器完整显示，长按回到时间页，未重启。**
- **卡片长度（dev12/13）**：镜片实测一张卡片约 56 字后直接截断、没有省略号，旋钮不滚动文字；卡片正文上限定为 48 字。确认卡去掉了“＋提交，删除到手机改”后缀，只显示识别文字。[证据](../../rebuild/android-app/phone-card-length-probe-2026-10-22.json)。
- **传稿（dev14–16）**：照搬鸿蒙版的 business17 拉取式传稿（文件 UUID 即 DID）。宿主 1.0.7 只把收到的 FILE_TRANSFER 帧交给 SHARE 能力观察者，`messageReceived` 永远收不到，所以新增 `PrompterSharePort`，在提词会话期间挂到现有通道上。SHARE 帧里的设备号是 MAC，须经 `Y3.D.a` 转成会话所用的规范 ID。
- **开始（dev16→17）**：dev16 在双就绪后立即自动发 type3，镜片短暂出现提词后眼镜重启。dev17 只传稿：眼镜收齐稿件后自己发起开始，手机全程未主动发控制，只回确认；用户确认问题和 4 个选项完整可读，长按回到时间页，没有重启。重复开始是首要怀疑原因，但未证明。新闻页的“开始提词”按钮仍在（需等到 type10 state1 才算运行），但本轮未用到。[dev16](../../rebuild/android-app/phone-prompter-share-dev16-2026-10-22.json)、[dev17](../../rebuild/android-app/phone-prompter-manual-dev17-2026-10-22.json)。
- 待办：重复试验与多分块长稿；退出提词器后自动开始口述，并把口述的选项号映射为选项；CLI 按长度分流（短的是/否走卡片，其余走提词器）并把分流结果告诉 Agent；放不下的内容给一张“请看手机”短卡。

**2026-10-22 眼镜闭环更新（dev11 /10433，回退 dev10）：Hermes 原任务两次提问都在眼镜上完成回答，并已写入文件。**
- **dev10**：`free_text` 问题以一张卡片显示在眼镜上：“问题；＋口述回答，删除留手机”，问题不超过 36 字。按＋后卡片退场，手机打开该问题的语音页，眼镜就绪后自动开始采音；按＋就算明确开始。20 秒内未就绪则不自动开始。
- **dev11**：眼镜发起的口述结束后，眼镜弹出识别文字确认卡，识别文字不超过 37 字。按＋时，手机先核对页面上仍是同一份未改动的草稿，再保存并提交原文。按删除，或在手机上开始编辑，确认卡撤回，答案留在手机修改。
- 两种卡片的接受操作都不会直接生成答案。交接只在卡片完全退场后进行一次，30 秒内有效，不跨重启，也不带到下一个问题。
- Hermes 新增 `io-workspace-cli-v1` 工作区权限：在提问工具之外，开放文件读写、补丁、搜索、终端和后台进程。文件编辑只在会话工作目录内自动允许，敏感路径和危险命令的许可请求一律拒绝；默认登记仍为问答专用权限。
- 测试身份改为 `io-test-mac` / `io-test-hermes`，因为卡片上的电脑名和 Agent 名都不能超过 16 字。
- 实测 phone311：Hermes 提出“要写入的文件名是什么？”和“要写入的一行文字是什么？”，两次都用眼镜口述回答；随后写入 `录音测试.txt`，内容与第二次回答一致。服务器回执依次为 agent_received、task_resumed、task_completed。
- 待办：口述结束仍需在手机上操作或等到 30 秒上限；超长识别文字不能在眼镜上确认；两次回答分别是在眼镜还是手机上提交的，未单独记录。凭据已撤销并核对为 401，诊断驱动已卸载。[证据](../../rebuild/android-app/phone-hermes-glasses-loop-2026-10-22.json)。

**2026-10-22 Hermes 原任务口述更新（Mac，dev9 /10431，回退 dev8）：Hermes 收到口述并继续，但未写成文件。** Hermes 固定于 `08165d5`，在项目本地 `.runtime/hermes-agent` 另建环境，未改动用户 `~/.hermes`。在 Mac 上运行需要三处修复：POSIX 进程托管（`process_job.py` 的 `PosixProcessJob` 加 `session_exec.py`）；提问截止时间被拒时返回 `now_utc` 和有效范围（模型据此重试一次即成功）；dev9 手机“移除已到期会话”（只能移除已过期且未选中的会话，16 个会话位释放了 3 个）。本人佩戴眼镜回答“文件名叫眼镜测试，内容是语音回答通过”，核对后保存。答案一次消费并产生 task_resumed，模型复述正确。但 `io-question-cli-v1` 按设计只开放三个提问工具，所以没有写文件。随后模型又发了一个“内部探测”问题，原任务结束时该问题未回答，调度器按保守规则记为 execution_unknown，手机没有收到结果文字。是否给 Hermes 开放文件或终端工具属于单独的产品决定，不得默认开启。phone308/309 的合成任务已关闭，凭据撤销后经身份接口核对为 401，诊断驱动已核对哈希后卸载。[证据](../../rebuild/android-app/phone-hermes-original-task-2026-10-22.json)。

更新于 2026-10-22，供另一位 AI 从当前代码基线开始工作。需求及顺序分别以 `PRD.md`、`DEVELOPMENT-PLAN.md` 为准；本文件不关闭尚未通过的验收出口。

## 当前基线

- **最新装机 dev8 /10430，回退 dev7 /10429**，APK SHA-256 `88b05d33c07e160a430d46b655a612f0dfcdf18f668a4aa10799c3ab33e4c36b`。dev8 将官方解码器设为双声道，只送左声道 PCM 至识别；原双声道音频包继续留存。H07-V03 本次真人佩戴实测：识别全文与预定回答完全一致，用户反馈“看上去是排除环境音了”，文本未见旁人内容，核对提示已显示。用户批准后已保存，服务器全文 SHA-256 与手机一致，voice 来源、原任务/问题版本/路由匹配；voice306 的 3 个合成任务已关闭、3 类凭据撤销并验证 401，手机测试连接已暂停，诊断驱动和端口转发已清理。[证据](../../rebuild/android-app/phone-wearer-channel-dev8-2026-10-22.json)。单次实测不构成声道恒等于身份或所有环境均可过滤的保证；原生 AI mode4 的过滤方式尚未核实。下段 dev7 为历史基线。

- Android 已装 **0.5.3-dev7 / 10429**（回退 0.5.3-dev6 / 10428），固定官方宿主 1.0.7 / 230；当前包 SHA-256 `485bae2b646928f845d307ed603385e52c846abd957d361ba3847f8ad7b25a02`。dev7 修正检查页核对提示被状态说明覆盖的问题（真机待下次口述确认）。H07-V03 真人实测：重新口述真机通过、四项条件均识别正确，但旁人说话会被拼入答案，[证据](../../rebuild/android-app/phone-wearer-voice-h07v03-2026-10-22.json)；口述解码目前按单声道，本人/环境区分待研发。dev6 在口述检查页加入“识别有误？重新口述”（检查阶段草稿转为已取消并保留本机记录，再为同一原问题准备新口述）和否定词/数字核对提示，JVM 通过，真机待联合实测。dev5 起超 256KiB 的正文单独标记 `MATERIAL_EVENT_TOO_LARGE` 并跳过，同批其他正文继续；dev4 在未知错误提示后附原始错误码。dev3 首次在 macOS 构建：宿主钩子 DEX 与 Windows dev2 逐字节一致，相对 dev2 仅清单、自有 DEX 及产品信息变化。同签名覆盖后登录、资料连接及六个已存版本保持。
- **R2 80%、R3 70%、R4 55%** 为按交付出口的粗估。Android 成熟后才启动鸿蒙适配，不同时重写两套平台业务。
- 一分钟原生卡静置、旋转续时已经用户确认，原 PRD 两分钟阅读及其他正式门槛保留。
- 正常手机语音页完成一条 codex 合成路由：明确开始、144 帧 / 275200 字节 PCM、5 段最终识别，四项条件完整；停止回执、空闲及原生/采音/协调器释放通过。正常保存后服务器原问题的全文哈希、voice 来源、任务、问题版本及路由匹配。没有启动真实 Codex/Hermes 运行时。
- 2026-10-22 在 macOS 上用 dev5 补齐另外两路：Mac 以 `say` 合成声源、`afplay` 外放到眼镜，qa（voice303）和 hermes（voice304）均通过采音、四项条件、安全停止并经服务器回读全文哈希与 voice 来源；凭据经 SSH 签发、用后撤销并核对 401，6 个合成任务已关闭。过程中发现：播放结束需留约 2 秒静音再停止；识别会把“附加条件”误为“不加条件”（关键词检查仍通过）；已进入检查阶段的口述草稿在同一问题上无法放弃重录，未完成草稿则会丢弃。[证据](../../rebuild/android-app/phone-voice-routes-dev5-2026-10-22.json)。
- 智记真实正文及修订此前已同步服务器并回读；本版“按月份查找智记”实际返回三个日期，空选禁用及取消通过。2026-10-22 用户批准后在凭据到期前真机选日同步：选 10-10、10-11 两天经月份入口同步，服务器确认保存，读取 2 天、发现 3 份正文，已存版本保持 6、无待发/待核对/未知；原样重复一次结果相同，无新增版本。dev4 三天全选（含 10-01）因单条事件超过 256KiB 报 `MATERIAL_EVENT_BUDGET`，整批中止、未上传。dev5 修复后同样三天：读取 3 天、发现 4 份，超限 1 份未上传未截断，其余照常，已存仍 6、无待发，重复一次相同。[dev5 证据](../../rebuild/android-app/phone-month-oversize-dev5-2026-10-22.json)。计数为手机服务器回执账本，本机无 pc-query 凭据，未做服务器逐条回读。[证据](../../rebuild/android-app/phone-month-select-sync-dev4-2026-10-22.json)。月份是日期线索，仍经按日 list→full→list 成员核对后入队；每批最多七天，空结果不删除。
- voice301 与 voice302 两轮合成任务已关闭，临时凭据已撤销并核对各角色 401；手机测试连接暂停、原 QA 默认目标恢复。守卫和驱动已移除，原音草稿留存。本轮优先级改为 GitHub 交接，第二次月份选择已取消并刷新，没有选择日期或发起月度导入。

dev2 的取消提示残留已在 dev3 修复：选日对话框“取消”及返回键均刷新页面，真机两条路径已核对“正在读取”文本清除、计数保持 6/0；本月无日期提示的返回键同样刷新。[证据](../../rebuild/android-app/phone-month-cancel-dev3-2026-10-22.json)。

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

1. R4：选日同步及重复幂等已真机通过（10-10/10-11）。超限正文已改为单条跳过并提示（dev5）；10-01 那份要上传需协议层分块方案（禁止截断或伪拆分）。正式凭据 2026-10-22 14:10 到期后需新批准才能续签。随后调查增量刷新、原音映射和权威删除，日历缺失不能产生墓碑。
2. R3：三路合成路由的实体口述已通过；Codex 当前原任务已完整闭环；Hermes 原任务已收到口述并继续，但仍需一次干净完成：不要求写文件的任务完成后，手机能显示结果。另需决定生产登记是否开放文件或终端工具。dev6/8 重新口述、核对提示及一次真人佩戴左声道过滤已核对；下一批适配另一真实 Agent，另保留前后台状态恢复及多环境过滤复测；保持停止/退出/占用交接与过期撤回保护。现有测试结果不能替代真实运行时接线。
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
