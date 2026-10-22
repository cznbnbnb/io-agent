# BASE-03 / P24：历史原音回放与原句定位

日期：2026-10-16。依据[PRD BASE-03、7.1](./PRD.md)和[开发计划P24](./DEVELOPMENT-PLAN.md)，本批补齐正常录音页、智记页的历史原音播放入口，并将有可靠时间的当前原句接到同一播放器。已有录音、转写、资料修订和总结链路继续复用，不重新采音或重做解码。

**0.1.92/10092离线候选已完成代码、宿主回归、真实DevEco、官方验签及来源审计，未安装、未验证出声。** 功能提交`15e0d44`，最小修复提交`91ead2f`；完整App final2为1631/1631，821份测试、编译、当前及暂存来源一致，新run为`20261016-033127456-6117dd99`。签名包SHA256为`661b52532ad6649b4f6a6a2fd7852d2315248d946a1291b136e9d9755aa566e9`，476,576,310字节，6005项产品载荷核对通过。手机最后实际验证安装仍为0.1.84，手机已断联；当前保留84已装包与92待装包、已核对硬链接和一份92源码暂存，上一[91候选](./phase2-summary-notes-2026-10-16.md)已取代回收，历史证据保留。首完整App final和首DevEco失败记录不覆盖；本批没有设备、实际播放器出声、镜片或完整语音端到端结论，不更新Excel。

## 当前代码能做什么

正常录音历史条目增加播放入口，完整原音可以独立于转写文字播放；智记历史条目使用同一个播放器。播放区显示准备、播放、暂停、定位、结束、停止或待处理状态；位置和总时长在系统尚未回报时显示未知，确认后才显示时间。提供暂停、明确继续、前后15秒和停止，不在进入页面、进程恢复或回到前台时自动起播。

当前支持实际已完成且通过原有覆盖校验的录音立体声PCM WAV，以及已封口、通过实际OGG扫描的智记OGG；兼容符合现有元数据的历史智记单声道WAV。原始Opus包不直接当作媒体文件播放，不为本批永久生成另一份WAV。缺音频、未封口、覆盖或格式不符时明确拒绝，原文、修订及导出入口继续保留；文件存在不等于可以播放。

逐句编辑区增加“播放原句起点”。页面只传原资料种类、严格名称、当前修订号和原句ID，音源层重新读取当前canonical资料，核对未删除、修订和原句仍匹配、相对起止时间有效后决定起播偏移。整段播放从0开始，不要求已有转写正文；原句定位需要当前资料及可靠时间。人工拆句后只有父句范围、句内时间未知的条目不猜测起点，也没有逐字高亮或播放至句末自动截断的承诺。

录音页另修正一个真实正文绑定缺陷：对当前资料作空正文更正后，原页面曾可能保留旧非空正文，却展示新的修订号。现在更正回调直接采用当前`row.text`，包括空串；不以旧ASR镜像填回这次空更正。此修复与原句回放使用同一当前修订，不能用旧文字配新版本。

## 音源、播放器与页面的边界

| 部分 | 当前实现职责 |
| --- | --- |
| `LocalAudioSource` | 只接受`recording/take-<32位小写十六进制>`或`lifelog/seg-<32位小写十六进制>`及成组的修订/原句锚点。检查现有元数据、实际媒体完整性、当前资料和删除状态，创建独立只读描述符与内容引用；调用方不能传路径、URL、fd、格式或起播偏移。祖先目录链接与根路径反例已取得宿主红绿记录，仍须由最终集成及设备证据限定实际支持范围。 |
| `PlaybackController` | 页面与CLI共用一个实例。每次明确播放建立新session；暂停、继续、定位和停止绑定该session。异步边界核对前台、当前轮次及音源；旧回调不能推进新轮次。公开快照只含音源引用、状态、系统回报的时间、回调序号与安全错误码。 |
| `NativePlaybackDriver` | 用HarmonyOS MediaKit的本地fd源，不改变系统音量或输出设备选择。先等初始化、准备及实际状态变化；定位等待`seekDone`，位置取实际播放器值，不能把请求位置写成已观测结果。中断或输出设备不可用时撤销自动续播意图，系统恢复通知不自动播放。 |
| `RecordingService`、生命周期与正常页面 | 导出同一个`localPlayback`；录音页、智记页和原句入口订阅其状态。离页、后台或Ability结束撤销待起播并开始释放，回前台不续播。删除先等待匹配音源停止，再核对原页面/条目；直接删除路径也在墓碑或删文件前检查描述符是否已释放。 |

媒体只读租约与采集、转写所用描述符独立。起播、明确继续或定位等关键节点作强校验，持有音源期间的周期和回调检查使用轻量文件身份、元数据及当前资料头，不在每个时间回调重算整个音频。来源替换、删除或锚点修订变化会撤销旧播放。

停止意图先失效，再等待原生释放成功，之后才关闭租约。释放失败或超时保留一个受隔离的播放器和描述符，显示待处理并阻止继续增长新的播放器；允许明确重试停止。不以超时当释放成功，不在仍占用原音时先写删除墓碑。已停止的快照不是可跨进程自动恢复的播放检查点。

## CLI调试出口

沿用现有HDC私有收件箱，新schema8严格为基础六字段加`playback`，与卡片、收音、任务、恢复、查询、总结和附注schema隔离。新增六个动作：`playback-play/status/pause/resume/seek/stop`；正常页与CLI调用同一个Controller，不另造播放器或模拟点击。

`playback-play`只收四字段音源选择。整段的`revision=0`和空原句ID成组；定位播放必须提供有效修订与原句ID。其余控制使用实际状态返回的session；seek另收毫秒位置，受输入上限和实际已知时长限制。status只读取内存，不扫描音频、不创建播放器。没有附件或原音传输，仍使用2048字节命令与65536字节结果上限，schemas1–7保持原行为和输出形状。

命令先耐久落本机意图，App先保存running再调用控制；同ID的running或终态不重放。命令传输或结果不确定时只对账原ID，不自动重发播放、生成新session或猜测成功。`reconcile`返回原控制回执；核对当前播放器须另发`playback-status`。`control_call_completed`只表示控制调用返回，`phase/native_state/callback_seq`及实际时间是另一组证据，`audio_output_verified`始终为false。

下例只说明现有解析器的参数，本文编写时未在设备执行。变量必须取实际条目、当前canonical资料或播放器返回值，不能虚构名称、原句或session。

```powershell
python tools/phase1/io-card-cli.py playback-play --playback-kind recording --playback-name $recordingName
python tools/phase1/io-card-cli.py playback-play --playback-kind lifelog --playback-name $segmentName --playback-revision $revision --playback-utterance-id $utteranceId
python tools/phase1/io-card-cli.py playback-status
python tools/phase1/io-card-cli.py playback-pause --playback-session-id $sessionId
python tools/phase1/io-card-cli.py playback-seek --playback-session-id $sessionId --playback-position-ms $positionMs
python tools/phase1/io-card-cli.py playback-resume --playback-session-id $sessionId
python tools/phase1/io-card-cli.py playback-stop --playback-session-id $sessionId
```

## 验证记录与实际出口

| 层级 | 当前证据截止与实际边界 |
| --- | --- |
| 实现与定向宿主检查 | 新音源/Controller/原生适配器、正常页面与schema8代码已接入。[targeted报告](../../rebuild/phase1/playback092-targeted-source-validation-2026-10-16.json)为183/183、退出0、无skip，821份来源在测试期间未变，快照SHA256为`5597df396180de73bcd876f80c5763b102f2f7333f39536d79b4f709047452af`，scratch已清。[原日志](../../rebuild/phase1/playback092-targeted-native.log)。实际Store、RecordingSession、OGG写入/扫描和真实文件IO用于音源检查；页面平台、系统播放器及HDC为明确替身。独立音源21＋页面25的46/46红绿复核也通过；这些与debug定向等均是套件子集，不能累加作产品验收。 |
| 完整App与来源绑定 | 修复后[final2报告](../../rebuild/phase1/playback092-final2-source-validation-2026-10-16.json)实际**1631/1631、退出0、无skip**；821份来源在测试期间未变，源码快照SHA256为`3ac0f2d03b4fcec1492ab5606365090e31e26105c52c052f4a283f11ffe7d333`，scratch已清，[日志](../../rebuild/phase1/playback092-final2-native.log)保留。首轮[final报告](../../rebuild/phase1/playback092-final-source-validation-2026-10-16.json)仍按实际1629项、1622通过、7失败、退出1保存；旧821来源`5597df…452af`及[失败日志](../../rebuild/phase1/playback092-final-native.log)不覆盖。7项旧页面VM已最小补齐生命周期端口，相关46项定向是完整套件的子集。文件名中的native指宿主执行，不等于DevEco编译或手机通过。 |
| CLI来源验证 | [50/50 Mock HDC来源报告](../../rebuild/phase1/playback092-cli-source-validation-2026-10-16.json)已通过，退出0、两份Python来源未变、scratch已清，[日志](../../rebuild/phase1/playback092-cli-native-final.log)保留。不代表真实HDC、手机播放器或实际出声，不与App项数相加作端到端通过。 |
| 真实DevEco编译 | 修复后另起新run`20261016-033127456-6117dd99`，已[终态complete、退出0、compileSucceeded=true](../../rebuild/phase1/candidate-runs/20261016-033127456-6117dd99/status.json)，无fallback；hvigor耗时2分50.906秒，821份manifest汇总SHA256与final2的`3ac0f2d0…7d333`一致。首run`20261016-031545360-c4b90245`的[compile_failed账本](../../rebuild/phase1/candidate-runs/20261016-031545360-c4b90245/status.json)和小日志继续保留，未修补失败暂存冒充新构建。 |
| 官方签名、验签与载荷 | 新run的[签名终态](../../rebuild/phase1/candidate-runs/20261016-033127456-6117dd99/sign-finalization-status.json)及[最终来源审计](../../rebuild/phase1/playback092-source-audit-offline-2026-10-16.json)已确认官方签名/验签true、6005项产品载荷；签名包为476,576,310字节，SHA256 `661b52532ad6649b4f6a6a2fd7852d2315248d946a1291b136e9d9755aa566e9`。这是本批实际结果，没有沿用91的哈希或用宿主测试替代验签。 |
| 来源审计与产物留存 | [离线审计](../../rebuild/phase1/playback092-source-audit-offline-2026-10-16.json)已终态通过，测试、编译、当前与暂存821来源均为final2快照`3ac0f2d0…7d333`；[最终留存](../../rebuild/phase1/playback092-offline-retention-2026-10-16.json)为complete，仅84已装＋92待装两份物理签名包及已核对硬链接、一份92源码暂存。91包/暂存及92可重生成输出已回收，小日志/来源清单/账本保留，未建大归档；同run未签名输入已退役，不允许再次签名。此前首失败stage的1,118,427,760字节[精确清理记录](../../rebuild/phase1/playback092-failed-run-cleanup-2026-10-16.json)保留，当时84/91保护包未动，不与最终留存阶段混淆。 |
| 手机与自动化 | **未做、待设备重连和同哈希候选安装**。开发者自动核对覆盖升级/原资料字节、WAV及OGG起播、暂停/继续/定位/停止、原句起点、后台/切页释放、源变化和独立合成条目的删除；核对真实播放器回调，必要时用波形或输出捕获区分控制状态与实际输出。无需用户朗读、制造资料损坏或手动重复点击。 |
| 人工与产品验收 | **未做**。只将实际屏幕可读性和必要的主观听感/输出路由登记为H04补充，待自动化前置完成且用户开始集中验收后再做。BASE-03、P24整体及AC-REC仍需相应真机证据，不能由本批宿主通过关闭。 |

以下失败与修正记录必须保留，不能用最后通过抹掉：

- 音源真实文件首测暴露缺失WAV的错误分类：原先会被笼统归为完整性问题；现代码先区分文件不可读取，再核对已有完整WAV资格。修复后的真实IO定向已绿，并被targeted、完整final2和新DevEco构建覆盖；实际手机行为仍待验证。
- 录音空正文的真实Store修订反例先取得[失败](../../rebuild/phase1/playback092-page-empty-red2.log)，再修正页面回调并取得[定向通过](../../rebuild/phase1/playback092-page-empty-green.log)。两份公开日志与私有原件SHA逐字节对应，私有首轮历史继续保留，不用静态字符串检查替代真实修订变化。
- 只检查末端目录不足以排除祖先junction；音源根祖先、资料根祖先及纯分隔符/盘根/相对或带点根路径先取得[3项真实红测](../../rebuild/phase1/playback092-source-ancestor-red2.log)，修复后音源与页面合计46/46通过、来源未变、受控scratch已清。公开红测日志与私有原件同字节，私有`playback092-source-ancestor-{red,red2}.log`及`playback092-source-page-ancestor-final{.log,-audit.json}`继续保留；后续已被targeted与final2覆盖，没有据此宣称真机路径保护已验收。首次EPERM发生在测试前置文件准备，不是已复现的生产音源失败；保留前置失败与后续受控运行记录，不skip或改断言掩盖。红数不累计作验收数量。
- 完整final的7项失败来自`manual-transcription-page`旧VM：新增页面离页会调用`playbackUnsubscribe`及共享播放器，但旧夹具没有这些端口。夹具补上明确的`snapshot/subscribe/suspend`，另加2项离页断言；原转写取消、正文/修订与其他保护断言保留。修复后相关46/46定向通过，记录为`rebuild/phase1/device-private/playback092-manual-page-final2{.log,-audit.json}`，随后完整final2通过；首完整final的失败记录仍保留。
- 首次真实DevEco编译在4处catch重抛触发ArkTS类型错误；修复只明确抛出`Error`类型，没有放宽音源校验、停止/释放或会话门禁。失败run账本、来源清单和小日志与首完整final均保留；修复后同源完整final2、另一个新run、签名及离线审计已通过，设备出口仍未验证。
- debug实际Controller首轮的模拟driver错误地在准备后的初次seek回报paused，触发正常的停止续播保护；按实际driver的`player.state`回报修正夹具，仍保留“实际位置不同于请求位置”的断言。[首轮日志](../../rebuild/phase1/playback092-debug-controller-first.log)及[后续定向日志](../../rebuild/phase1/playback092-debug-final.log)均保留，此处不是生产播放器真机通过。

## 本批没有关闭的事项

实际设备是否支持所选OGG/WAV解码、从何设备出声、音量/路由和主观有无爆音断音仍待真机核对。本批不自动选择眼镜或耳机为输出，不把普通录音声道统计当本人声源或骨传导麦克风证据。音频路由和真实听感必须与系统播放器状态分开报告。

连续后台播放、跨进程自动续播、播放波形产品界面、逐字跟随、高亮及原句自动截断不属于本批已实现能力；当前策略是离页/后台停止。没有为本批扩展模型、转写、服务器同步、TTS或Agent协议，也没有改变原厂固件。

H07-T01要求的两分钟连续可读仍未修复；H07-V02有效有声和可靠退出、H07-C01完整答案确认及原任务结果仍开放。本批原音播放不证明助手收音、退出ACK或完整有效语音闭环通过。人工清单沿用[USER-VERIFICATION-TODO](./USER-VERIFICATION-TODO.md)，不重复已确认旋钮、头势和当前时区时间。
