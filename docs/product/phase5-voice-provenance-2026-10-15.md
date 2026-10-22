# P51/P53/P54：完整口述转存后的来源保护

日期：2026-10-15，候选版本 **0.1.88/10088**。需求、开发顺序和正式出口仍以[PRD](./PRD.md)、[开发计划](./DEVELOPMENT-PLAN.md)为准。本批承接[0.1.86完整答案保护](./phase5-answer-durability-2026-10-15.md)及[0.1.87明确选择恢复](./phase5-draft-recovery-2026-10-15.md)，补齐口述全文转存后仍须保留的来源证据，不更换对外协议、原厂固件或停止政策。

本批源码已提交为 **`c96802a`**。整App **1341/1341**、805份测试/编译来源一致性、真实DevEco编译（1分31.255秒、无fallback）、官方验签及6005项载荷核对均通过；[最终离线审计](../../rebuild/phase1/provenance088-source-audit-offline-2026-10-15.json)和[受控留存](../../rebuild/phase1/provenance088-offline-retention-2026-10-15.json)完成。run `20261015-231418418-a6e8a7c7`，签名HAP 475901997字节，SHA256 `eddaa57c09fcf0e1275e36d453b8fadd48760ff4b02add6352bef5441c1b3859`。本批设备离线、**未安装**；最后实际安装仍为0.1.84，没有新开麦、发卡或真实语音端到端验证，Excel不动。

## 本批解决的具体场景

完整口述“用新价格，但运费沿用上次”通过现有退出及转写门禁后，先复制到原问题的答复草稿，再清空采音副本。此前，迟到的同连接type3音频会经过已经idle的采音对象返回正常语音路由；采音对象的晚包计数已清空，原问题草稿却仍可确认并入队。仅保护尚未清空的capture，无法保护已经转存的全文。

本批先持久保存独立来源记录，再复制全文，并在清空capture前核对一次同一来源。采音副本清空后，来源记录继续观察实际连接；相关晚包使来源失效，正常确认、入队和HTTP发送前都须重新检查，拒绝把旧的“完整口述”当作仍有效的新答案。已经保存到原问题的全文保留，不能通过删字、截断条件或重建另一个会话解决来源不明。

首次真实模块红测保留于[copy→clear→late原日志](../../rebuild/phase1/provenance088-copy-red.log)：真实capture完成、真实草稿复制及清空后，晚包未重新进入ASR，capture晚包计数为0，但真实`TaskSuggestionSession`仍调用入队一次。该测试使用合成音频解码和受控ASR文字，不是镜片、实际有声转写或真实Agent验收。

## 来源记录与接线

新增[TaskVoiceSources](../../rebuild/harmony-sdk/entry/src/main/ets/TaskVoiceSources.ets)实例由`TaskService`持有。`AgentCaptureService`提供当前设备及认证连接轮次，`AgentReplyCapture.receive()`在active/retained过滤前观察business13包，断连路径先使独立来源失效，再通知capture断开。业务包继续交给原有接收流程；观察器不消费或修改原包，不自行解码、开麦、发BLE命令或访问HTTP。

`sourceOrigin(token,text)`只接受本次进程内完成的精确token、全文、当前peer及正认证轮次，且必须已满足完整转写、Worker结束及既有退出证据。旧诊断夹具的epoch0、冷恢复文字、只有本地停止写入或只有Worker退出，都不能生成可信来源。

每个来源引用为精确六字段的`TaskVoiceSourceRef`，自身schema为1；它与草稿schema是不同层级：

| 字段 | 含义及约束 |
| --- | --- |
| `schema` | 固定1 |
| `attempt_id` | `voice-`加32位小写十六进制，标识这一次明确授权的口述 |
| `peer` | 实际来源设备，1–256字符 |
| `connection_epoch` | 本进程随机boot标识与实际认证轮次组成的字符串，1–128字符；恢复来源使用未知标识 |
| `binding_sha256` | 固定顺序编码后的完整原问题绑定SHA256，包括请求/修订、操作、任务、原电脑/Agent/项目/会话、期限、问题、模式及有序选项 |
| `text_sha256` | 原始完整UTF8文字SHA256；不trim、不删换行或附加条件，非法孤立UTF16代理项拒绝 |

新增`task-voice-sources.json`为schema1的来源旁文件。它保存引用、operation、context/目标/事件摘要、原期限和观察/投递状态，不复制全文、原音、完整问题或完整route。全文仍由原capture及原问题草稿承担，采音文件保持原schema3。

主要API及职责如下；它们不是新的外部任务协议，也不是麦克风授权：

| API | 本地职责 |
| --- | --- |
| `register(binding,attempt,peer,epoch,text)` | 仅当前正认证轮次可登记；成功持久化后才返回ref，同attempt只有完全一致且仍watching时可幂等取回 |
| `restore(binding,attempt,peer,text)` | 保留匹配的旧ref或创建unknown引用，不把冷恢复升级成watching |
| `assertAnswer(answer)` | 核对草稿schema、全文、完整绑定、来源引用及当前连接；未知/失效/legacy语音拒绝 |
| `pin(answer)` | 在入队前把同operation固定到同ref及同全文/选项；不能换另一次口述顶替 |
| `beforeSend(operation,event,contextKey)` | 仅在实际POST之前核对不可变原事件并持久标记dispatch，再做返回前末检 |
| `observe(peer,epoch,business,payload)`、`disconnected()` | 晚包永久标记tainted，断连变unknown；不重放或自动恢复可信度 |
| `status(answer)` | 只读当前完整答案所适用的有界状态/哈希/计数，不返回正文、原token、peer或会话路径 |

`TaskVoiceReplySession`在复制前后均取得并比对同一个ref。`TaskSuggestionSession`把schema与完整ref纳入原有全文CAS，并在确认可用性、异步核对之后、seal和deliver前检查。`TaskService.answerBound()`另行检查并pin，避免绕过页面直接调用服务就跳过来源。Debug状态只允许固定状态及安全元数据；外来、坏格式或与当前ref不匹配的观察不能声称当前答案watching。

## 容量、文件保全与冷恢复

来源文件最多**128条记录、1MiB**。本批不自动裁剪、不删除已完成来源，也没有后台清理按钮；触顶明确拒绝新来源，不能宣称已满足长期日用容量要求。已有记录仍可执行匹配pin、失效记录和状态检查。后续清理策略需要单独设计，必须保留仍可能发送或对账的来源。

每次初始化生成新随机boot标识；失败仅保护语音来源，不伪造默认随机值。加载的旧记录即使磁盘写着watching，在新进程也为有效状态unknown。相同peer重新连接、同全文再次登记或旧采音恢复，都不会复活原来的有效性。

文件采用有界实际字节读取、严格UTF8、原始SHA256和主文件CAS；写入通过实际短写循环、`fsync`、关闭及`.partial`原子改名，写入前及改名前均检查过时主记录。已有中断文件、孤件、未知schema/字段、损坏、无效UTF8、过大文件或冲突会保留原字节并保护语音，不直接截断重写。迟包失效先在内存生效；持久化失败也不能回滚为watching。物理掉电、硬件磁盘故障和真机文件系统持久性尚未验收。

来源旁文件与`task-decision-draft.json`的明确恢复不是同一个事务。87的main/partial/resume入口不修复来源文件；来源文件损坏时尚无独立修复或安全清理入口，不能删除它并宣称恢复可信度。独立手机文字答复不依赖来源文件健康，仍须通过自己的原请求、期限、身份和发送规则。

## 草稿兼容与明确采用手机文字

`TaskDecisionRecord`新建为schema2，精确12字段，其中`voice_source`必须显式为null或有效ref。schema2非voice只能为null；voice+null可读取为来源未知，但不能据此发送新的口述答案。`TaskReplySubmission`同步携带`record_schema`及完整`voice_source`，复制和相等比较必须包含二者。

原schema1精确11字段继续严格读取；初始化、清理和普通resume不自动加入字段、不改变旧属性顺序或静默迁移。旧schema1全文无论原标phone还是voice，都保留为legacy；不能因曾经保存完整就当作新的来源已确认答案。

新恢复事务采用`paused-v2`：保留所选input_source及ref，清除旧选择和旧seal；`voice_authorized`仍退回需要再次明确同意的补充阶段，恢复后暂停，不自动发卡或开麦。已持久开始的`paused-v1`事务仅接受schema1来源，按它先前承诺的旧归一化字节及哈希续完；它仍是legacy手机文字结果，不被改写成新来源证明。原归档、UID并集、active独占、尺寸、哈希及中断续完规则保持。

来源unknown/tainted/missing/blocked或legacy时，正常页面保留原问题及全文，用户可明确选择“已核对全文，以手机文字为准”。确认对话框之后，服务冻结完整原绑定、全文、选项、来源、schema和阶段，再联网核对原请求；异步等待后复核全文CAS、前台、context、原期限、清理占用及完整outbox。任何同operation既有发送记录都禁止采用覆盖，不能只检查最近20条。

`adoptPhone()`只把已核对的同一全文保留为schema2/review/phone/null ref，清除旧选项，模型先暂停；正常服务完成核对后才允许继续。它不自动提交答案、不重新开始任务，也不因来源失效便先发拒绝。用户后续确认仍走原来的全文提交及同operation发送链。CLI只观察来源元数据，没有模拟同意、采用手机文字、提交或开麦的入口。

## POST前门禁与投递不确定

outbox、服务器事件schema及eventID重试/查账方式保持。完整事件不夹入新的本地ref，既有不可变payload不会被来源状态更新重写。已存在的同operation/同字节重试仍对账原事件；不允许用另一份ref、条件或任务绑定替换它。

发送前可能等待identity、request及task网络核对，这期间来源仍可能失效。因此`beforeSend`位于实际POST之前，而非只在用户点击时检查。它核对pin、原context、请求/修订/任务/完整route/全文/选项/事件，持久标记`dispatch_started`后，在同步通知回调返回时再次核对当前来源与实际磁盘，防止通知期间断连或迟包已经使来源失效却继续POST。lookup/reconcile只查询原eventID，不调用此新发送门禁。

门禁拒绝且HTTP尚未开始时，`blockUnsent()`仅在精确send claim、attempt、partition及同payload匹配后持久改为本地blocked，不捏造HTTP回执。若本地拒绝落盘失败，当次运行保留原sending状态与失败`.partial`，返回`TASK_PERSIST_FAILED`，不调用`finish(status=0)`冒充“网络响应丢失”，也不在该次live流程自动发POST或启动事件查询。不能把“已拒绝尝试”写成“本地blocked已持久成功”；本批不据此宣称整个邮箱获得了来源文件同等级的通用冷启动中断恢复。

`dispatch_started`在真正调用HTTP前持久化，是保守的“已进入发送边界”标记，**不是服务器已保存**。如果标记后因末检失败而未POST，来源仍可能显示投递不确定；这比错误声称一定没发出更保守。进入发送后再有晚包、断连或进程中断，也只能提示`delivery_uncertain`并查询既有发送记录，不自动撤回、改写原答案、清除outbox、重投新事件或取消电脑任务。服务器保存、Agent收到、原任务继续及任务完成仍分别核对。

## 验证结果与待补设备验收

| 检查 | 本批已取得的结果 | 限制 |
| --- | --- | --- |
| 原copy→clear→late红测 | 1项失败；清空后晚包计数0、错误入队1次；原日志保留 | 改生产之前的缺口证明，合成音源及受控ASR |
| 来源旁文件首轮 | 38/38通过，真实D盘文件IO、SHA256、严格UTF8、短写及受控故障注入 | 不包含随后根代理补充的POST通知末检最终汇总；不代替真实崩溃/掉电 |
| 两个真实capture/草稿/会话定向场景 | 2/2通过；清空后的来源tainted、晚包1、入队0，全文保持 | 无设备、无真实ASR或HTTP发送；capture本身清空后的晚包计数仍为0，来源证据在独立旁文件 |
| AppRuntime及后台生命周期夹具 | 14/14通过，显式核对来源先于capture断连；保留连接及旧超时不会误断新连接 | 本机替身，不等于鸿蒙后台或蓝牙真机证明 |
| Debug来源元数据负例 | 外来/畸形ref、无ref误称watching及非字符串reason问题已修，全部随最终统一回归通过 | 仅披露匹配当前合法ref的有界哈希/计数；不把draft_saved等同来源有效 |
| 最终整App | **1341/1341**通过，805份来源测试期间保持一致；[冻结记录](../../rebuild/phase1/provenance088-final-source-validation-2026-10-15.json) | SHA256 `cccca5eda57e667dd40740f5eefe42b92dd34057ca96397d3d3486420b6d5570`；受控D盘临时目录已清理，无设备/Excel操作 |
| DevEco、官方签名、构建来源及受控留存 | 原生编译成功、无fallback；官方验签/6005载荷、805来源及逐字节审计通过 | 已保留84已装/88待装两份物理签名包，别名为核对后的硬链接；一份88源码暂存，87及可生成输出回收；冻结unsigned已退休，同run不可重签 |
| 覆盖安装、镜片、有声口述回原Hermes任务 | 未做 | 手机和眼镜离线；最后安装84，不能以本机测试关闭AC-ASK |

定向测试的受控目录在本项目D盘，临时文件仅由对应夹具创建并回收；没有访问HDC、手机、服务器或新增构建副本。最终统一回归已对同一805份冻结来源执行并记录，本表开发中定向不单独替代该步骤。

## 保持开放的出口

本批不放宽`device_event`/`user_confirmation`退出证据、音频排空、Worker结束、完整转写或共享占用门禁；type7/rc1写入完成及安静一段时间仍不能自动视为眼镜已经退出。来源保护是继续研究较弱退出协议之前的独立基础，不能据此宣称原停止问题已经解决。

用户要求的两分钟连续可读仍**未修复**；App120秒待答租约不等于镜片持续显示。H07-V02有效口述、H07-C01完整答案确认、H07-T01两分钟可读性及正式P51/P53/P54、AC-ASK保持开放，继续按[集中人工TODO](./USER-VERIFICATION-TODO.md)准备后集中验收。本批不新增要求用户制造存储故障或重复已确认旋钮/头势的验收项，也不重发卡片催用户。

下一步离线推进有界来源回收及受保护修复策略，并继续助手有效采音/退出路径的独立研究；不靠删除文件消除容量或损坏保护。设备重新具备条件后，只验证与本批相关的正常全文采用/来源保护及真实语音闭环，安装前保留现有资料、收音清理义务和不可变发送记录。真实存储中断、长期稳定性、镜片及语音原任务结果仍需各自证据，不能以本批宿主结果提前关闭。

统一验证保留失败历史：最初定向385项有384通过，唯一失败为旧采音服务测试替身未注入新增TaskService端口、导致AssetStore依赖未模拟；补明确来源观察端口后，最终整App通过。根独立重现的pin通知重入和POST标记通知重入缺口均先红后绿；POST拒绝落盘失败真实回归也已通过。单文件测试脚本首次标量数组展开错误仅为启动失败（Module Not Found），修脚本后39项中38通过、1项实际末检红测，最终随全App通过；这些日志均保留，不把脚本故障计作产品缺陷或产品验证通过。
