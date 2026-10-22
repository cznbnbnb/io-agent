# P24：单条录音结构化总结、持久进度与原文引用

本批0.1.94已由[0.1.95待办删除候选](./phase2-todo-delete-2026-10-16.md)取代并按留存规则退役，录音总结实现保留在95中。下方为94当时来源及验证记录，重连安装和H04-S01前置使用当前95同哈希包，不使用已退役94。

## 最终离线交付（2026-10-16）

当前候选 **0.1.94/10094**，最终来源`e896931`（主功能`6fbe9dd`，兼容修正`34e224e`）。本批增加正常录音页和CLI上的独立结构化总结、当前原文引用、多版本重开、MD/JSON导出及有界长文检查点；原音、转写和每日总结保持各自保存路径。

- [完整final3](../../rebuild/phase1/summary094-final3-source-validation-2026-10-16.json)：**1793/1793**，退出0、834份来源未变、scratch已清；来源快照`d1e3596ca406c2467bef17e2e2293d49fdaba11c1401036b07b3ade049b88792`。
- [本批Python CLI](../../rebuild/phase1/summary094-cli-source-validation-2026-10-16.json)：实际**57项Mock HDC**，含旧schema1–8及新schema9。没有真实HDC或模型请求；App相关63及各分项都是子集，不相加作产品验收。
- 真实DevEco run`20261016-054852791-80d77ddd`：**5分7.626秒、无fallback**；官方验签与6005产品载荷通过。签名HAP 476,869,200字节，SHA256 `5da2765de09444a362e6eb654b66289b37417bfc7e66292ec28f65cedbe137a9`。
- [离线来源审计](../../rebuild/phase1/summary094-source-audit-offline-2026-10-16.json)已核当前/测试/编译/stage及签名包；[留存完成](../../rebuild/phase1/summary094-offline-retention-2026-10-16.json)，仅84已装＋94待装两份物理签名包及核对硬链接、一份94源码stage，退役93及新build/.cxx/unsigned已回收，旧93三份原生验签小证据11,300字节保留，无大归档，同run不能重签。

**94未安装，手机最后实际验证仍84；本批无真实模型质量、真实系统选择器、出声、镜片或端到端结论。** 重连先以同哈希94覆盖并自动核对资料保留，再做合成短/长文真实模型对照、冷重开/导出和状态恢复。必要人工体验仅H04-S01/已有H04-A01集中验收，用户无需制造故障、反复朗读或重测已确认头势。H07-T01两分钟未修复、H07-V02有效语音/可靠退出、H07-C01完整答案回原任务及正式8小时/功耗仍开放。Excel未动。

首full1791/1792、首次ArkTS编译失败、bootstrap/不合法历史行夹具失败均保留。final2为1792/1792但早于最后引用修正，仅是历史宿主结果。下文保留实现细节及分阶段证据，所有当时“待终态”以本节最终结果为准。

## 实现与分阶段历史

日期：2026-10-16。依据 [PRD 7.1、7.3、7.5](./PRD.md)、[P24开发顺序](./DEVELOPMENT-PLAN.md)及[开源方案对照](./speech-summary-open-source-review-2026-10-14.md)。本批为 **0.1.94开发候选，尚未安装**；上一批完整离线交付为[0.1.93每日总结修复](./phase2-summary-integrity-2026-10-16.md)，手机最后实际验证安装仍为0.1.84。设备已带走，本批没有HDC、眼镜操作、真实模型调用或Excel更新。

**当前状态：首次完整App为1791通过/1失败，首次原生构建失败；测试调度及ArkTS兼容修正已落地，完整final2正在运行，重新构建、签名、来源审计和留存仍待终态。** 首次失败记录保留，下列定向通过不等于最终候选已通过或正式P24/BASE验收。

## 实际入口与范围

普通录音页选择“查看文字”后，原文/原音区域旁新增独立的“这条录音的总结”。原录音接收、转写、回放及原文导出保持各自链路；本批不把单条总结混入每日AI缓存、人工附注或原转写。

- “生成新总结”先预览当前文字量与处理组数，再明确确认发送；只发送所选当前修订的转写文字到已配置模型，不上传原音、不执行待办或Agent任务。确认框等待期间原文变化会再次核对并拒绝旧来源。
- 页面显示保存状态、完成步数、已用请求数、模型、生成时间和转写覆盖状态。停止保留已保存进度；恢复需重新确认，不在重开页面、冷启动或联网后自动继续。
- 已保存版本和未完成进度按有界元数据分页，提供“更多版本/返回首批”；列表不携带总结正文，只有明确打开的当前有效`ready`版本显示正文。目录不完整、来源变化、读取失败和未知生成时间分别表达，不冒充“没有资料”或“已完成”。
- 总结分为事实回顾、待办候选、待确认问题和建议，分别折叠。引用原文由当前资料重建，不能把模型的概括当原话。仅可靠的原句时间提供“播放原句起点”；正文残余、未知时间或拆分后未确定的时间不伪造定位，文本片段也不等于字词的精确音频时间。
- MD/JSON独立导出绑定同一任务、检查点与来源。系统选择器返回后、首次目标截断前及每次读写边界核对`isCurrent`；先成功读源再打开目标。取消保留本机结果；来源失效或离页/后台不继续写旧内容。已经写出部分后才失效，只停止后续并报未完整，不承诺回滚外部文件。

新增总结目前仅本机保存与手动导出，**未接资料同步、服务器总结查询或电脑Agent**。没有改原音上传、全天智记总结或用户资料留存规则。

## 分层处理、预算与来源

`RecordingSummaryPlan.ets`复用真实`MaterialStore/LocalMaterialQuery`，将已封口、未中断的录音当前修订规划为片段和有界归并树；已有转写可标`unknown/pending/partial/complete`，总结只说明文字覆盖，不能由此证明音频、识别或事实完整。

当前实现的共同限制为：规划文字总量最多120000个UTF-16单元，单片段最多3000，最多128片段、8个叶组；每次结构化输入最多20000，最多15个生成/归并步骤。每一步最多两次尝试，整个任务最多30次模型请求，**明确恢复和不确定结果后的重试也计入**。这些限制共同生效，并不保证任意120000单元输入都能规划成功；超预算明确拒绝，不截掉尾部冒充全文处理。

结构化请求使用现有HTTPS配置、独立请求所有者和1500输出token预算，不带普通聊天历史、搜索或执行工具。仅接受唯一助手文本且`finish_reason=stop`的完整响应；长度截断、工具调用、异常结构和取消后的迟到内容不保存为成功。随后解析严格JSON：四类条目最多20项、每项正文最多512个UTF-16单元、引用最多8个；规范结果最多8000个UTF-16单元，`covered_ids`必须完整匹配本步原始片段集合。覆盖ID表示处理过这些文字，不保证模型未遗漏重要事实、否定或责任人。

来源使用完整当前资料JSON指纹及标准引用：`material_id/revision/text_revision/utterance_id/content_sha256/source_range`。模型只能引用给定片段ID；原文引用、字符区间、说话人来源及时间来自当前资料。更正、删除、重新转写、同修订内容被改写或来源不可读时旧版本变为失效，不能通过打开历史记录复活旧正文。片段太长时按Unicode边界拆分，不插值音频时间；无法确认的说话人和候选身份不升级为“我”或真实姓名。

## 持久进度与恢复

`RecordingSummaryService`在独立`recording-summaries-v1/rsum-…`目录保存哈希相连的不可变检查点。每次请求**先持久记账，再发送**；保存完整步骤后才推进下一步。每个检查点上限2MiB、每任务16MiB/96个状态、任务目录最多128个；列表每页最多10条，并有扫描/读取范围提示。不自动清理旧版本来绕过容量限制，长期保留/回收规则仍开放。

停止、退后台或离页只停止本总结服务，保留完成步骤及不确定标记，不取消助手、每日总结、ASR或录音。冷重开只读取；未知的旧调用可能已计费，显式恢复可能再次调用模型，不声称提供方恰好执行一次。恢复用`job_id + state_sha256`核对完整状态和当前来源，配置模型/地址必须匹配原任务；旧请求的迟到结果不能完成新轮任务。

完整`.partial`须逐字节核对、再次打开并`fsync`后才可明确续完提交；坏文件、未知状态或内容冲突保持阻断。若最后步骤结果已完整落入待提交状态，即使请求预算已用尽，也可仅完成本地提交而不再请求模型。源码已补此边界及启动/恢复返回实际启动后状态、失效版本不保留生成完成时间；[4项恢复独立复核](../../rebuild/phase1/summary094-recovery-review.log)实际退出0，另覆盖合法长原句ID及同步恢复回调中的取消不被启动覆盖。最终兼容修订后的统一完整回归仍待终态。宿主文件故障注入不等于真实掉电或所有磁盘/系统故障已验证。

## schema9调试接口

现有App CLI追加schema9，复用同一正常总结服务，没有另建模型、麦克风或任务通道。命令为`recording-summary-preview/start/status/cancel/resume/list/read/citation`。`start/resume`必须提供`--confirm`；其他命令禁止混入确认标记及旧schema参数。`cancel`含义为停止并保留进度，并非删除资料。请求UID先落盘再调用；同ID、冷启动遗留`running`及`reconcile`仅对账，不自动再发。

以下是解析器约定示例，**本批未实际向手机执行**；`reference.json`须来自当前资料的完整标准引用，不能手编旧版本指纹：

```powershell
python tools/phase1/io-card-cli.py recording-summary-preview --recording-reference reference.json
python tools/phase1/io-card-cli.py recording-summary-start --recording-reference reference.json --confirm
# $jobId、$stateSha分别填本次已返回的job_id和当前state_sha256，不能沿用过期值。
python tools/phase1/io-card-cli.py recording-summary-status --recording-job-id $jobId
python tools/phase1/io-card-cli.py recording-summary-resume --recording-job-id $jobId --recording-state-sha256 $stateSha --confirm
python tools/phase1/io-card-cli.py recording-summary-read --recording-job-id $jobId --recording-state-sha256 $stateSha --recording-format md --recording-offset 0 --recording-max-chars 4000
```

`list`返回元数据及游标；`read`返回绑定同检查点的完整MD/JSON分块，按`next_offset`继续到`has_more=false`，偏移以UTF-16计算且不拆代理对。`citation`同样绑定检查点和片段ID。CLI回执`complete`只说明这次本地控制调用完成；生成是否`ready`、来源是否有效需新`status`核对，不能当真实模型质量、设备效果、服务器收件或Agent任务完成。

## 已有证据与待补终态

| 验证层级 | 当前已发生的结果与限制 |
| --- | --- |
| 页面与真实IO | [新页面测试](../../rebuild/harmony-sdk/tests/recording-summary-page.test.mjs)初轮33项32通过/1失败：确认框等待期间来源更正后仍调用`start`，受控服务拒绝，未外发。页面已补确认前fresh预览；[首轮日志](../../rebuild/phase1/device-private/summary094-page-first.log)保留。修后新33项及旧播放/手动转写/删除58项共91/91、退出0，旧夹具和原断言未改；[日志](../../rebuild/phase1/device-private/summary094-page-second.log)。 |
| 页面与真实持久服务 | 新增真实`RecordingSummaryService + Plan + MaterialStore + D盘IO`生成、冷重开、引用、MD/JSON实际复制、选择器等待时源更正保护、持久暂停/明确恢复和迟到旧结果隔离；阶段同文件36/36、退出0、无skip，[原日志](../../rebuild/phase1/device-private/summary094-page-service-first.log)保留。首次全套中的唯一失败来自长导出测试依赖`setImmediate`与timer先后顺序，观察到524288而非262144字节；已在测试中明确控制真实页面复制的yield边界，保留原写入/停止断言，生产页面未改。修后[36/36报告](../../rebuild/phase1/summary094-page-yield-controlled-2026-10-16.json)及[日志](../../rebuild/phase1/summary094-page-yield-controlled-native.log)退出0、来源未变、scratch已清。该复验第一次忘设`DEVECO_HOME`，在装载TypeScript前失败，[独立失败报告](../../rebuild/phase1/summary094-page-yield-bootstrap-failed-2026-10-16.json)和[日志](../../rebuild/phase1/summary094-page-yield-bootstrap-failed-native.log)保留，不算产品反例或36项业务运行。模型请求、选择器、UI和播放器仍是受控端口，没有网络/模型实测或真实听感。 |
| 规划及HTTP组件 | [Plan/Remote定向日志](../../rebuild/phase1/device-private/recording-summary094-plan-remote-final.log)实际76/76、退出0。真实调用规划和新`RemoteServices.structuredSummary`，HTTP响应/取消为合成替身，不是提供方实测或总结效果验收。 |
| 持久服务 | [首轮公开日志](../../rebuild/phase1/summary094-core-first.log)14项13通过/1失败，启动返回旧`resumable`而非实际启动后的状态；[修后阶段运行](../../rebuild/phase1/device-private/summary094-core-second.log)14/14、退出0。随后`.partial fsync`、预算末端本地收尾等4项独立恢复检查[实际4/4、退出0](../../rebuild/phase1/summary094-recovery-review.log)。保留各自源码时点与失败，不把分项相加当最终验收。 |
| schema9 / Python CLI | 本批已实际运行Python57项Mock HDC，[公开来源报告](../../rebuild/phase1/summary094-cli-source-validation-2026-10-16.json)及[日志](../../rebuild/phase1/summary094-cli-native-final.log)均确认退出0、来源未变、scratch已清，包含schema1–8回归；不是复用旧版报告。App控制层/真实总结服务接线相关[63/63日志](../../rebuild/phase1/device-private/recording094-cli-app-final.log)及[来源报告](../../rebuild/phase1/device-private/recording094-cli-app-final.json)退出0。HDC、模型和设备均未实际调用。 |
| 完整App与来源 | 首次[final报告](../../rebuild/phase1/summary094-final-source-validation-2026-10-16.json)与[日志](../../rebuild/phase1/summary094-final-native.log)终态为**1792项、1791通过/1失败、退出1**；834份来源，快照SHA256 `b9a54cf6feb77a84af226a5bff9d4e978a18aeb4e331454981bdd1a2db5ca047`，测试期间未变、scratch已清。唯一失败为上列页面yield测试；测试修正及原生兼容源码`34e224e`后，final2正在运行，终态和新来源SHA待补，不能沿用首轮旧快照证明修后候选。 |
| DevEco / 官方签名 / 留存 | 首次真实run`20261016-052556027-89cb7802`已`compile_failed`、退出-1，[状态账本](../../rebuild/phase1/candidate-runs/20261016-052556027-89cb7802/status.json)及[原始构建日志](../../rebuild/phase1/candidate-runs/20261016-052556027-89cb7802/build.log)保留。实际阻断为`RecordingSummary.ets:226`的`Array.from({length},()=>0)`触发ArkTS泛型推断限制；`34e224e`已改显式循环`push(0)`，没有据宿主通过宣称原生兼容。失败stage清理Apply仍在预校验，重新构建/签名/审计/留存均待终态，不预填HAP哈希或“两包一暂存已达成”，也不复用93包冒充94。 |
| 真机 / 真实模型 / 端到端 | 未验证。未安装94，无系统选择器真实布局、大字窄屏、真实模型完整率/质量、性能功耗或设备原句听感结论。 |

本批不是所有总结场景的最终替代：每日汇总长文迁移、跨录音/智记重叠去重、服务器/Agent综合总结、长期容量策略及模型效果对照仍按各自依赖推进。H07-T01两分钟连续可读、H07-V02有效有声及可靠退出、H07-C01完整答案回原任务均保持开放；本批不会发卡、开麦或重复已确认的头势/旋钮测试。

## 追加来源引用兼容修正

最终业务来源为e896931（主功能6fbe9dd，ArkTS/yield兼容34e224e）。标准引用的source_range按六字段值比较，JSON对象键顺序不再影响同一来源；值有变化仍拒绝。旧比较方式在独立标准LocalMaterialQuery引用上已复现误拒绝；新增真实MaterialStore人工拆句→倒序JSON引用→生成/引用/坏值拒绝测试通过1项。首个手写历史行夹具不符合Store拆句规则的失败日志保留，随后改用真实correctSpeakers写入，没有放宽生产校验。日志见summary094-reference-order-fixed.log与fixed2.log。

final2实际1792/1792、834份来源、退出0且未变，快照a5410df995e62976ea63102feed53de6f018144f73cba3003c6d63a03fc8a495；它早于上述引用修正，只作历史宿主证据。最终来源须以正在运行的final3和新run20261016-054852791-80d77ddd为准，不将final2混用于新包。首次失败stage已按recording094-failed-run-cleanup-2026-10-16.json精确回收1,118,692,168逻辑字节，小证据、84/93包与93stage保留；它不是成功新候选的留存收尾。
