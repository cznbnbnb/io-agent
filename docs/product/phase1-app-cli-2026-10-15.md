# App CLI首批：隔离建议卡调试

关联：用户2026-10-15新增CLI优先开发目标、P10/P51/P54、H07-T01。正常产品页面及官方基础体验要求保留。

## 本批边界

0.1.82候选先提供`status`、`show-card`、`remove-card`、`reconcile`。这是本机HDC到debug App私有目录的隔离卡片控制入口；不另建BLE连接，不模拟屏幕或终端输入。调用真实`SuggestionTestSession`的business21/type33与原UID清理；固定实验文案、120秒App清理期限。页面原P10实验仍默认60秒，正常原任务卡保持120秒，二者都不代表固件保证持续显示。

该入口没有创建待办、提交Agent答案、开启录音或取消电脑任务的命令。日常Agent鉴权/配对、正常原请求发卡及资料/录音等CLI扩展尚未实现，不能把本批当完整CLI目标完成。

## 操作

前置：安装对应debug候选、HDC已授权连接，App在前台且眼镜已连接；命令不自动解锁、不重启App。一次发送一条命令，先核对结果；执行不明只做对账。`reconcile`读取原命令的冻结执行结果；查询现在状态用新的`status`。

```powershell
python -X utf8 tools/phase1/io-card-cli.py status
python -X utf8 tools/phase1/io-card-cli.py show-card
python -X utf8 tools/phase1/io-card-cli.py status
python -X utf8 tools/phase1/io-card-cli.py remove-card --uid <status返回的p10实验UID>
python -X utf8 tools/phase1/io-card-cli.py reconcile --id <先前返回的dbg命令ID>
python -X utf8 tools/phase1/io-card-cli.py cached-power
```

默认HDC路径及设备序列号可用`--hdc`/`--device`覆盖。输出为NDJSON：本机意图已保存、命令结果/状态快照。`complete`只表示CLI控制执行完成，`active`/`remainingMs`表示本地实验生命周期；均不是镜片显示、用户回答、服务器保存、Agent收到或任务完成。输出明确`lens_display_verified=false`，实际观察仍由H07-T01记录。

## 执行和恢复约束

- SDK的`applicationInfo.debug`为true才初始化控制器；正式构建不创建调试目录或轮询器，无新增网络监听/导出Ability。当前私有文件通道依赖已授权HDC。
- App只读固定私有入口`io-debug/command.json`，仅处理前台命令；命令严格白名单、唯一`dbg-`ID、60秒有效期，参数不含凭据。输出也在私有目录，命令不能指定任意文件路径、原始协议载荷或执行函数。
- 每个ID先耐久保存`running`再调用设备服务。完全相同的重复命令只读取已有结果；同ID不同命令拒绝。崩溃后`running`表示效果不明，禁止自动重复执行。CLI对账只读取原ID结果，不重新传输命令。
- 移除要求精确匹配当前P10 UID，不操作正常任务卡；卡片发送仍走现有连接和占用检查。过期不提交答案；原UID清理义务保留。
- 独立占用观察回调不被页面`changed`回调替换：任务卡与实验卡合并维护共享卡片租约，实验卡在首个设备写入前就阻止录音/智记/提词/助手/其他卡片抢占；任务配置暂停不能清掉实验卡租约，实际清理后才释放。保留含清理义务的断线状态，不能因控制器停止就假装镜片已退出。
- 轮询器属于Ability运行时并在销毁时停止；命令不触发Ability重新进入前台，避免每次调试都触发任务重载/卡片暂停。debug后台不执行命令，返回前台时过期命令拒收。该调试轮询不作为8小时功耗验收结论。

## 当前验证分层

控制器的重复、过期、冷恢复模糊执行、存储失败、UID错误及dispose场景已有宿主验证；真实私有文件读写、真实建议卡会话、120秒窗口及正常运行时定向回归通过。硬件/解码器为显式替身，不据此证明镜片停留时长。首轮完整回归暴露其他后台生命周期fixture漏注入新模块，保留失败日志并修复；真实构建/签名/装机及CLI真机结果另补。

语音接线WIP已按文件及哈希保存在忽略的私有备份中，从本批候选隔离，待CLI独立批次收口后恢复。不要把其代码存在或此前独立收音提示当成完整语音回复通过。Excel未修改。

## 冻结候选与签名差异处理

最终run `20261015-155726672-6f13c5fe`：50项相关及1027项完整App通过，DevEco CLI真实编译通过。前两个预览run保留、不签名安装；最后候选补齐原UID冷恢复。源码/独立暂存792份来源核对通过。签名包475489696字节，SHA-256 `1a22bc9c01cf2a2791979f2647f2d3ffb03d729d9655ff83130f5472b85318f0`。到本节写入时尚未安装，镜片未验。

第一次签名后检查拒绝发布：6005个产物条目中只有`ets/sourceMaps.map`原始字节变化，长度均1774780；严格解析后的152个根键及全部值相同，差异为JSON对象键排序。原失败`sign-status.json`保留。构建校验增加仅限此固定路径、同长度、最多4MiB的严格JSON内容等价分支，保留原始哈希与内容身份哈希；拒绝重复键、错误UTF-8、深度溢出、数组顺序/标量/映射变化，代码和其他资源仍逐项按字节哈希检查。现有原生签名绑定与`.pages.info`唯一附加条目规则保持。

13项合成ZIP正/负例及32项原有run守卫回归通过。对已存在的同run签名产物执行一次独立finalization，官方原生验签、内容比对和来源核对全部通过，`originalFailedSigningPreserved=true`；没有再签名、改写原编译状态或忽略映射文件。实际映射差异证明写入finalization的`sourceMapOrderProofs`及`repackedPayloadProof`。首次沙盒来源审计因TEMP目录不同拒绝匹配，随后在实际构建使用的原生环境核对通过，未放宽目录规则。

## 真机CLI回环已通过

0.1.82覆盖安装完成，PID18712→47304，安装前录音/智记/ASR空闲；五份资料/原音/转写/目录/同步队列及原任务邮箱、失败任务邮箱、当前已完成/时长实验邮箱、草稿和收音账本保持。装机后792份来源再次核对通过，源码提交`bd03a99`、签名校验修复`e260349`；公开断言见[CLI真机证据](../../rebuild/phase1/card-cli082-native-2026-10-15.json)。

通过真实HDC私有文件通道运行：status空闲→固定实验卡发送→原ID reconcile→status匹配原UID→错误UID移除被拒→正确UID移除→status空闲。手机实际返回结构化回执，卡片首个写入前的running记录、共享占用及清理释放均有证据；实验账本仅一条send-intent/transport-submitted及一条对应移除，reconcile不重新执行。全程未通过屏幕按钮发卡或移除，未开启收音、提交Agent答案或创建待办。原收音/草稿/当前任务邮箱在CLI结束后仍字节一致。

此回环中的卡由自动化主动移除，不是两分钟镜片时长实验，也没有镜片直接反馈。随后独立观察见下节；0.1.80两阶段摇头原任务子链的人工结论保持。普通完整CLI/Agent鉴权与其他业务命令、自由语音仍开放。Excel未改。

## 单张时长观察：两分钟持续可读未通过

0.1.82于16:25:15.706只下发一次，用户直接反馈“5秒就消失了”，对消失后镜片画面回复“没注意”。16:26:07.879新CLI状态仍同UID等待、剩67827ms、前台/连接/卡片租约正常、操作数0。16:27:15.710自然到期、15.729提交移除，相对send-intent分别120004/120023ms；原UID清理义务最终为空。没有盲目重发或刷新、没有新收音或Agent答案；原收音记录及原任务草稿字节保持。[公开断言](../../rebuild/phase1/card-duration082-native-2026-10-15.json)由`tools/phase1/summarize-card-duration082.py`从私有原始账本生成。

因此App未在5秒提前移除，但镜片连续可读两分钟未通过。原厂卡片自行收起与整屏息屏尚未区分，也未证明所有建议卡固定5秒；H07-T01保留这一缺口及后续最简观察。

新增电脑端`cached-power`无需重建App，只拉取既有`last-general-settings.json`和`launcher-rx.jsonl`，输出缓存自动锁屏秒数、最新type4接收是否与缓存完整匹配、读回时间和缓存年龄。真实只读运行得到autoLockTime=15、匹配接收08:18:08.310Z；明确返回`cached=true`、`fresh_device_query_performed=false`、`settings_changed=false`和`notification_timeout_seconds=null`。该值不是实时息屏状态，无法排除已部分经过的计时。未发送设备查询/设置，不从缓存推断根因。5项解析回归覆盖非法形状/值、缺失或冲突RX、无效/未来时间及缓存时效；本次无App修改，原1027项及构建证据仍绑定冻结0.1.82。

`tools/phase1/inspect-suggestion-serializer.py`对缓存官方Android `RecvSuggestMsg.toJson`实际调用的生成函数做限定地址反汇编：0x23e9a64委托0x1554a78，后者至0x1554c60的键依次为suggestUID、suggestType、type、title、source、content、timeRange，常量池位置逐项对应。[静态证据](../../rebuild/phase1/card-duration082-static-2026-10-15.json)保存输入SHA-256及每条键加载地址。这条已核对的发送序列化路径没有时长字段；不能把日程展示字符串timeRange当倒计时，也不据此断言固件拒绝所有其他字段。参考固件符号中有独立显示/建议重启/屏幕关闭清理计时名称，但未检查对应函数体、未证明与当前设备匹配，不能凭名称宣布根因或固定5秒。没有编译/刷写固件、设置改动或自动刷新循环。

## 0.1.83候选：原问题口述的观察和停止CLI

新增命令只控制正常服务已有的口述轮次，没有开麦、伪造头势、注入文字、改变草稿阶段或提交Agent答案的命令。schema1的六字段卡片命令保持兼容；新四命令用严格七字段schema2，加`expected_voice_binding`。仅用于单调用方串行调试，共用一个`command.json`，不能并行写入后猜测执行结果或重发。

```powershell
python -X utf8 tools/phase1/io-card-cli.py task-status
python -X utf8 tools/phase1/io-card-cli.py voice-finish --binding-sha256 <当前task-status的binding_sha256>
python -X utf8 tools/phase1/io-card-cli.py voice-cancel --binding-sha256 <同一轮次的binding_sha256>
python -X utf8 tools/phase1/io-card-cli.py voice-recover --binding-sha256 <待恢复轮次的binding_sha256>
python -X utf8 tools/phase1/io-card-cli.py reconcile --id <原dbg命令ID>
```

`binding_sha256`覆盖完整原始收音token，包括原问题/修订/完整路由/操作ID、原眼镜和新随机attempt。服务还核对当前配置及原绑定；哈希错误或轮次变化直接拒绝。`voice-recover`只重新核对并载入已有效保存的完整口述，不开麦，不越过期限或原问题状态。状态只输出ID、阶段、退出证据、文字长度及哈希，不输出问题、口述正文、token或完整配置。

`control_call_completed`仅表示控制方法返回；`draft_saved`才表示原问题已有语音草稿，两者都不是服务器/Agent/任务完成。停止返回时可能仍在等退出或清理，须发新的`task-status`看当前状态。`reconcile`始终返回原命令的冻结结果，不重发、不更新成当前状态。冷恢复且没有内存token的`voice-cancel`仅暂停本地草稿，不代替正常页面的收音清理或设备退出证明。

当前轮次可观察包数/PCM字节/非零包数、停止尾包、封口后晚到包、封口与尾窗超时、两条停止写入及Worker退出状态；均为元数据，不保存或输出压缩音频。`capture_metrics_available`为false时零值只是缺省值，不能推断为本轮真实零音频。口述复制到原问题草稿后收音副本会清理，当前统计也可能清零；`draft_saved=true`不自带终态尾包证明，没有采到该轮状态就记为未取到，不能把清空后的状态当成功证据。

当前这些是0.1.83源码候选；真实HDC schema2读写、错误hash拒绝、原ID对账及原记录保持的设备结果另录，不从宿主测试推断已在手机可用。

后续已在同源码真实构建/验签并覆盖安装0.1.83：7项被动真机CLI通过，含schema1兼容status、schema2 task-status、原ID冻结对账及三种错误hash操作拒绝，收音/答复草稿字节保持。此时无当前有效语音binding，`capture_metrics_available=false`，不把缺省零值当本轮采音；没有发卡、开麦或提交Agent答案。见[设备记录](../../rebuild/phase1/voice083-native-2026-10-15.json)。有效轮次的停止/恢复、有声及镜片仍待原问题第二卡真实授权后验收，不据这7项关闭完整语音或CLI目标。

## 0.1.84候选：完整答案卡的显示CLI

`task-status`新增`review_ready/review_block_reason/reply_binding_sha256`。新命令仅消费同一正常业务的本机展示前置及全文CAS，不自行拼接卡片或更改草稿：

```powershell
python -X utf8 tools/phase1/io-card-cli.py task-status
python -X utf8 tools/phase1/io-card-cli.py review-card --reply-binding-sha256 <当前reply_binding_sha256>
```

`review-card`严格使用schema3七字段，新增的字段仅`expected_reply_binding`；不能与schema2的`expected_voice_binding`混用，`--binding-sha256`仍仅用于原语音轮次。正文、回答语义、开麦、提交、取消任务均不属于此命令。只有之后真实当前UID的type34确认，才能通过正常业务把完整答案交原任务；`requires_physical_confirmation=true`和控制调用complete不能当作已回答。

hash涵盖原请求/修订/操作/完整四项路由、问题选项、期限、完整答案、来源及原peer；异步刷新后再次CAS，显示期间不能改字。过长或带控制字符的正文不截断，转手机完整核对；冷恢复保持暂停。ready不证明服务端或镜片，原因只输出固定枚举，状态不披露正文/token。

`reconcile --id`仍只读原结果，包含错误回执；不得用它刷新当前准备状态，也不得对不明执行换ID重试。HDC私有文件仍限单调用方串行，正式Agent鉴权及更广业务CLI不由本批完成。完整确认的代码、设备和人工分层结果见[本批说明](./phase5-full-answer-review-2026-10-15.md)。

### 0.1.85离线候选观测扩展（尚未安装）

`task-status`保留原schema2命令，增加当前原绑定适用时的`compressed_packets/compressed_bytes/repeated_compressed_packets/last_compressed_sha256`、`first_audio_at/last_audio_at/stop_requested_at/input_sealed_at`、`pcm_rms/pcm_peak`、`transcript_status/boundary_evidence/observation_restored`。压缩重复仅指连续相同摘要；不保留原帧，不由这些值推断麦克风/声道身份。恢复记录不提供新鲜数值，`capture_metrics_available=false`；字段缺省0不是一次零音量实测。

`quiet_after_stop`仅为本机有界封口依据，不能代替`exit_evidence`。complete仍待实际退出时不可恢复/转存；partial、cancelled、legacy不能升级为complete。CLI没有新增人工退出确认、开麦、头势模拟、seal或提交答案的入口。1141/1141最终宿主回归、真实DevEco编译/官方验签及797来源核对已通过；设备验证因用户断开手机留待后续，不能据此声称新字段真实采样或语音端到端通过。见[候选审计](../../rebuild/phase1/voice085-source-audit-offline-2026-10-15.json)。