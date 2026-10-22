# P24：每日 AI 总结完整生成、独立保存与安全导出

日期：2026-10-16。依据 [PRD 7.1、7.3、7.5](./PRD.md)和[开发顺序 P24](./DEVELOPMENT-PLAN.md)。上一批为已验签未安装的[0.1.92 原音回放](./phase2-local-audio-playback-2026-10-16.md)，手机最后实际验证安装仍为0.1.84；本批手机断联，不操作设备或Excel。

**最新已验签待安装候选为0.1.93/10093：完整final3、真实DevEco、官方验签、离线来源审计与留存均已通过，手机最后实际安装仍为84。** 业务修复`bc2da17`未变；`41feef7`仅修正历史`task-voice-sources`测试夹具使用受管TEMP及提前登记清理，没有改生产代码、IO异常或断言。修后整文件39/39及完整final3的1704/1704实际通过，新run`20261016-044503190-984a6f04`重新绑定824份当前来源。旧93旧来源包及stage已精确撤回，92也已按最终留存退役；目前仅84已装/93待装两物理签名包、核对后的硬链接及一份93源码暂存，小证据保留。首次final、原样final2和独立复验的Windows `EPERM`失败不覆盖，根因未证实，不能据后续通过归因于杀软、观察器或宣称改名已稳定。93未安装，也无真实模型、真机页面或端到端验收结论；本批未调用手机或更新Excel。

## 本批修复的三个问题

1. 旧`RemoteServices.summarize`只检查非空正文。HTTP成功但`finish_reason=length`的半截输出，仍可能被绑定到原文并保存为成功总结。现在仅接受唯一、完整结束的助手文本；错误、工具结果、未知结束状态、缺失状态、无效JSON和取消后的迟到结果均拒绝。保留正文Markdown，不靠裁剪伪造完整输出；普通聊天、搜索、HTTPS鉴权、30000 UTF-16输入上限和1500输出token预算保持原路径。
2. 旧“汇总→带AI总结/仅导出”未把当前来源守卫传给真实`copyOut`。系统选择器等待期间更正、删除资料、换日、离页或后台后，仍可能先截断目标再写旧内容。现在显式绑定页面轮次、日期、前台及完整原文快照，读源和写目标各边界复核；首次读失败或来源已变时不截断已有目标。已经写出部分后才失效，只能停止后续并报告未完整，不能承诺回滚已写字节。取消外部导出保留App内独立快照。
3. 自动总结原来只有`day-DATE.md`一个持久副本，普通上传原文又写同一路径，上传成功或失败都可能让AI正文消失。现在自动结果先保存内容寻址的独立快照，再更新每日缓存；独立保存失败不替换旧缓存，缓存更新失败则明确区分“已独立保存”和“缓存更新失败”。上传使用自己的不可变原文快照，不改写每日AI缓存，也不改变上传协议或擅自加入AI内容。

当前版本仍沿用原资料修订、原文全文指纹、`bindJournalSummary`、不可变写入，以及`.90`已保存总结的来源校验。`.91`人工附注不混入AI原文。完整结束状态只表示提供方报告生成结束，不证明事实正确、责任人归属正确或没有遗漏。

## 证据与验证分级

| 层级 | 当前实际状态 |
| --- | --- |
| 模型响应组件 | 旧实现35项首轮为14通过/21失败、退出1；修复及`tool_calls:null`无工具兼容检查后，35项新检查与19项既有远端检查共54/54通过，退出0。[最终定向日志](../../rebuild/phase1/summary093-response-green2.log)。真实调用`RemoteServices.summarize/request`，HTTP、响应和取消微任务为受控替身，没有调用真实模型，不将其计为总结效果验收。 |
| 导出组件 | 首轮25项运行4通过/21失败；失败条目包含真实竞态/读写反例、1项不合规长单句初始化夹具及父级子测试失败汇总，不能解释为21个独立产品问题。修正夹具后独立长文红测证明旧实现仍写出1,171,043字节，而来源失效后应停在已写的262,144字节。修复后新守卫和既有总结/附注相关94/94通过，来源前后相同、临时目录已清。[定向日志](../../rebuild/phase1/summary093-export-green-first.log)及[来源记录](../../rebuild/phase1/summary093-export-green-first-audit.json)，公开副本与原件逐字节相同。此大文件测试证明导出边界，不是新增长文AI能力。 |
| 自动保存及上传 | 旧生产实际方法[3项真实IO红测](../../rebuild/phase1/summary093-automatic-retention-red.log)全部失败：实际上传成功、上传失败均覆盖缓存，冷读找不到AI独立版本。修后新13项与既有修订绑定25项共**38/38、退出0、无skip**，[日志](../../rebuild/phase1/summary093-automatic-retention-green-first.log)及[来源记录](../../rebuild/phase1/summary093-automatic-retention-green-first-source.json)确认4个实际模块和2个测试前后未变。使用真实D盘文件、MaterialStore、JournalExport及新实例SavedJournalSummary；模型与上传网络为固定替身。 |
| 测试夹具隔离 | `41feef7`仅使`task-voice-sources.test.mjs`尊重受管TEMP、在可能抛错前登记清理；生产`TaskVoiceSources`、IO异常及断言未改，没有新增重试或吞错。修后整文件[39/39报告](../../rebuild/phase1/summary093-voice-sources-managed-temp.json)及[日志](../../rebuild/phase1/summary093-voice-sources-managed-temp.log)实际退出0，测试期间来源未变、使用独立D盘scratch、夹具自清且[wrapper清理完成](../../rebuild/phase1/summary093-voice-sources-managed-temp-cleanup.json)。它不能证明旧EPERM的根因。 |
| 完整App及来源 | 最新[完整final3报告](../../rebuild/phase1/summary093-final3-source-validation-2026-10-16.json)及[日志](../../rebuild/phase1/summary093-final3-native.log)实际为**1704/1704、失败0、退出0**；824份来源，快照SHA256 `b343a0c279716c5451f7c4f4dd076ffce105607c92e83c362ac1ff9a2c1dd69d`，测试期间未变、scratch已清。首次[final](../../rebuild/phase1/summary093-final-source-validation-2026-10-16.json)及原样[final2](../../rebuild/phase1/summary093-final2-source-validation-2026-10-16.json)各1703通过/1失败、退出1，旧824份快照`6b3ede6ce7f724f724657ec5a449a80bfe5ca29d1ca3fa5886189a69d104d639`及EPERM历史不覆盖。54、94、38、39均是完整套件子集，不相加作产品或端到端验收。 |
| CLI兼容 | 本批没有新增命令，也未修改或重跑Python CLI，复用[`.92`实际50/50 Mock HDC来源报告](../../rebuild/phase1/playback092-cli-source-validation-2026-10-16.json)。[本批离线审计](../../rebuild/phase1/summary093-source-audit-offline-2026-10-16.json)已核对当前两份Python文件SHA与该报告完全一致，明确`cli_rerun_for_this_batch=false`。不得将旧运行写成本批重跑或真实HDC。正常CLI的已保存总结列表/读取继续使用同一`SavedJournalSummary`服务。 |
| DevEco | 新真实run`20261016-044503190-984a6f04`的[状态账本](../../rebuild/phase1/candidate-runs/20261016-044503190-984a6f04/status.json)已`complete`，编译退出0、无fallback、用时3分41.873秒；824份编译、当前与stage来源均匹配final3的`b343a0…d69d`。旧040245850 run仅作为历史，不用于新包来源证明。 |
| 签名 | 新run的[签名终态账本](../../rebuild/phase1/candidate-runs/20261016-044503190-984a6f04/sign-finalization-status.json)已完成、官方验签通过，824份来源、6005项产品载荷。新HAP为476,581,509字节，SHA256 `10d1950909c879fa7fbcf25570b2cd17b1b0574fbdb7173ee589f2ad3cde8a16`，版本0.1.93/10093，未安装。签名不替代真机或真实模型效果。 |
| 留存、审计 | [离线来源审计](../../rebuild/phase1/summary093-source-audit-offline-2026-10-16.json)实际通过，确认final3/当前/compile/stage的824份来源一致，旧93撤回小证据、39项受管夹具及旧CLI50项复用绑定。[最终留存](../../rebuild/phase1/summary093-offline-retention-2026-10-16.json)Apply已`complete`：仅84已装/93待装两份物理signed及已核对硬链接、一份93源码stage；92包/stage及新run可重生成输出已精确回收，旧92约11KB原验签小证据私有保留，无大归档、用户资料/原音/凭据未动。同run不能再次签名。旧93的[精确撤回](../../rebuild/phase1/summary093-unaccepted-cleanup-2026-10-16.json)另保留约2.89GiB回收记录及原小证据，不把历史旧包当当前候选。 |
| 真机及真实模型 | 未验证。设备重连后由开发者自动核对覆盖升级/原资料、正常生成与独立重开、上传不覆盖、系统选择器及取消。本批不新增让用户制造资料错误、重复朗读或手动点击的测试。必要正常页面体验沿用H04集中验收。 |

原始失败与修正路径保留，不覆盖、不累加红数：

- 模型旧实现的[首轮红测](../../rebuild/phase1/summary093-response-red.log)保留35项真实运行；私有原始`summary-response-completion-green.log`为首次54项通过，[最终定向日志](../../rebuild/phase1/summary093-response-green2.log)补无工具`null`与空数组兼容后仍54项通过，非空工具或无效结构仍拒绝。公开副本与私有原件逐字节核对，原始日志和各自cleanup记录保留，不将合成HTTP当真实提供方效果。
- 导出[首轮红测](../../rebuild/phase1/summary093-export-red.log)和私有`summary093-export-red-audit.json`保留；不合规单句触发夹具初始化失败留下的唯一834字节合成孤件，经原件/范围核对清理，见[夹具清理记录](../../rebuild/phase1/summary093-export-red-fixture-cleanup.json)，不作为生产数据丢失。改用合法多句资料后的[长文红测](../../rebuild/phase1/summary093-export-long-red.log)仍取得真实生产边界失败；公开副本与私有原件逐字节核对，修正后94项通过及scratch清理另有记录，不把夹具问题算成产品红。
- 自动保存/上传首轮3项调用实际旧方法和真实文件IO，没有夹具EPERM或缺端口失败。修后13项检查独立版本先于cache、实际短写完成、snapshot写入/fsync/改名失败不碰旧cache、cache三类失败仍可冷读/实际导出完整版本并明确状态、更正/删除不复活旧总结、生命周期取消以及内容寻址冲突保留。旧25项只修改两项成功产物期望，分别核对cache与独立快照路径、同字节及来源修订；失败、生命周期和当前资料保护未削弱，没有改大型共享夹具。
- 首次完整final的[原始日志](../../rebuild/phase1/summary093-final-native.log)及[原样final2日志](../../rebuild/phase1/summary093-final2-native.log)各保留1704项中的同一容量测试失败：真实D盘`fs.renameSync`返回Windows `EPERM`。[第一次容量模式复验](../../rebuild/phase1/summary093-voice-capacity-recheck-1.json)退出0，[第二次](../../rebuild/phase1/summary093-voice-capacity-recheck-2.json)又出现同类`EPERM`、退出1，第三次未运行；两次来源均未变，各自fixture根前后均为空且已清理。公开日志、报告与cleanup均与原件逐字节核对。当前仅确认改名不稳定，尚未证明原因；不归因于杀软或环境瞬态，不改断言、跳过失败或反复重试到绿来宣称稳定。
- 一次不改生产源或IO结果的[运行时观察诊断](../../rebuild/phase1/summary093-voice-capacity-runtime-diagnostic.json)实际1项通过、未复现EPERM；[退出时观察明细](../../rebuild/phase1/summary093-voice-capacity-runtime-diagnostic-sidecar-53580-exit.json)为open/close各524次、rename进入/返回各130次，结束时未关闭FD及活动`readFileSync`均为空，临时目录已清。它只覆盖这次进程及独立合成目录，没有取得失败时的系统/外部进程句柄证据，不能排除原因或推翻两轮完整失败。本问题保留开放，不因此宣布生产持久化已稳定。
- 之后的`41feef7`修复夹具临时目录和清理登记，生产实现未变、未放宽断言、未加IO重试；39项整文件及1704项final3通过另留日志与来源报告。新通过不抹去旧失败，也未建立“旧目录、杀软或观察器导致EPERM”的因果证据。新快照变更来自测试文件，已另起044503190新run完成同源构建、签名和审计，没有沿用旧93包。旧run040245850虽曾编译/验签通过，其旧HAP SHA256 `d9e05779a168e0fa56a5f4cc5323e7f6108098a16cefea4561c3c11cc997aad5`及stage均已撤回，小账本保留。

## 上游依据与未完成事项

[DeepSeek官方响应契约](https://api-docs.deepseek.com/api/create-chat-completion/)将自然完成与长度截断、过滤、工具调用、资源不足和中断分开表示；本批仅在总结分支接受`stop`。它不改变普通聊天的旧响应兼容行为。

长文生成仍超过30000个UTF-16单元就明确拒绝，没有静默丢尾，也没有本批新建的分层或检查点。后续沿用[开源对照](./speech-summary-open-source-review-2026-10-14.md)中借鉴[LangChain分段归并](https://github.com/langchain-ai/langchain/blob/master/libs/langchain/langchain_classic/chains/summarize/chain.py)的方向：先冻结当前来源，再保留分段引用、有界调用、取消/恢复和覆盖说明；不能用中间摘要冒充原始证据，未比较效果前不替换默认路径。本批未引入新框架或模型。

普通录音页单条专属总结、PRD四类可折叠结构、逐结论引用、生成者/时间元数据、整日重叠资料关联去重、长文效果与持久检查点仍开放。独立版本属于需保留的资料；长期容量、保留策略和已保存目录128项有界扫描的限制也仍开放，不静默清理旧版本。

下一独立场景拟先做一条已封口录音的专属结构化总结、真实原句引用、独立版本重开/导出与有界长文覆盖；仅为下一批范围建议，尚未实现，不扩大本批交付。

H07-T01两分钟连续可读、H07-V02有效有声及可靠退出、H07-C01完整语音答案回原任务均未由本批关闭；原音回放实际出声和正式BASE/P24/AC验收也仍需各自证据。[建议卡解析器静态复核](../../rebuild/phase1/card-duration-stock-suggest-parser-audit-2026-10-16.json)核对参考AP 1.0.4.12的哈希、两个函数范围及七字段传递链，未在所审范围找到持续时间入口；参考AP未匹配当前设备，不证明所有路径不存在该能力，更不构成120秒修复或真机成功。
