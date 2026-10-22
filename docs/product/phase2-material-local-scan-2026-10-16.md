# P24：本机资料查询续扫

对应[PRD §7.3](./PRD.md)与[开发计划 P24](./DEVELOPMENT-PLAN.md)。本批版本0.1.96/10096，实现提交`c143918`，最终测试夹具修正提交`b15df9f`。正常智记页与schema11 CLI复用同一只读查询核心，增加后续资料的扫描入口，保留旧schema5首窗口查询行为；不改变原音、转写、摘要、同步队列或删除记录。

本批代码、完整宿主回归、真实DevEco构建和官方验签已通过，**最终离线来源审计及留存已完成，尚未安装**。[完整final2](../../rebuild/phase1/scan096-final2-source-validation-2026-10-16.json)实际1952/1952、退出0，847份来源快照`6b49907d6a6fb4e636fd92516858f61d12f897283941eb6611caf9ba9748c7a7`测试期间未变，scratch已清。新run`20261016-073924244-7e2cdad9`真实DevEco3分47.598秒、无fallback；[签名终态](../../rebuild/phase1/candidate-runs/20261016-073924244-7e2cdad9/sign-finalization-status.json)为complete、官方验签true/退出0、847来源和6005个产品载荷条目。签名HAP为477,097,117字节，SHA256 `3eece069c23df0f2395ab5502d2c140fa93339515021134680613bc1417613fd`。[最终离线审计](../../rebuild/phase1/scan096-source-audit-offline-2026-10-16.json)已核对测试、当前源码、compile和stage同源，并核对Git提交`b15df9ffc6a154ed9c2aeebf4afa994ad62ebfe0`中的受管输入；5份未进Git的本机构建配置/模型输入单列哈希，不表示提交包含模型。[最终留存](../../rebuild/phase1/scan096-offline-retention-2026-10-16.json)已Apply complete：仅保留84已装/96待装两份物理签名包及核对硬链接、一份96源码stage；95包和stage及当前可重生成编译输出已回收，95三份原生验签小文件共11,300字节保留，同run不能再次签名。[原字节证据总索引](../../rebuild/phase1/scan096-original-proof-index-2026-10-16.json)集中列出48份小证据，不包含安装包或大构建副本。

首完整1951/1952、首native虽编译成功却未接受/未验签、测试夹具修正及旧未签名生成物精确回收均保留在[历史证据索引](../../rebuild/phase1/scan096-history-evidence-2026-10-16.json)与[清理报告](../../rebuild/phase1/scan096-unsigned-failed-cleanup-2026-10-16.json)。最终full与新run不复用首批来源。手机由用户带走，最后实际验证安装仍0.1.84；96未安装，没有本批设备或端到端结论，Excel未改。

## 原问题与可用范围

[89首版本机查询](./phase2-local-material-search-2026-10-15.md)每次只读取排序后的前512份canonical资料，并在日期/关键词筛选之前累计完整记录的序列化UTF16长度。达到2,097,152个代码单元后停止。其命中游标只能翻阅这一个窗口，重复查询仍回到同一批资料，后续资料没有可到达的扫描入口。原有incomplete提示是正确的局部覆盖说明，不能把该问题写成资料丢失。

96保留单窗预算，增加两种独立操作：

| 操作 | 实际作用 |
| --- | --- |
| 本窗口下一页 | 使用当前scan_cursor和命中next_cursor，重新核对同一窗口并读取下一页命中；不推进资料扫描位置 |
| 继续扫描后续资料 | 使用next_scan_cursor，清空hit_cursor，切换到后续资料窗口；替换当前窗口命中，不累计为全库结果 |

每页最多10条命中，单条上下文预览最多160个UTF16代码单元；完整原文仍经当前资料引用打开。每个窗口内部按来源时间倒序，窗口之间按稳定资料目录位置继续，不能称全库最新排序。关键词与说话人仍须命中同一句，保留匿名/用户确认标签、重叠、部分转写、句内时间未知和拆句父范围，不凭命中补造原音完整性或人物身份。

某个窗口无命中而scan_has_more为true，只表示当前窗口未找到；到目录末尾也不表示此页包含以前窗口的全部命中。旧格式ASR镜像仍未索引。不可读记录、被跳过的超预算记录和不完整转写都不能算已查询全文。

## 资料目录与来源失效

MaterialStore.queryCatalog只读枚举全部资料ID、各资料的历史修订文件名及最新修订文件的身份/尺寸/时间元数据，产生目录摘要。合法新增、更正、删除发布新修订后，旧扫描游标失效；目录替换、链接或读取失败拒绝继续，不返回伪装为空的成功结果。一次窗口处理前后各核对目录观察，命中引用另外绑定当前完整canonical记录SHA256。

该目录摘要不是所有正文的内容哈希，也不是全库物理原子快照。扫描窗口之外的同版本正文改写不能仅靠目录摘要获得完整内容证明；当前窗口正文参与命中快照，打开原文时再次核对完整记录引用。合法写入使用不可变新修订；不把目录元数据方案宣传为任意磁盘篡改检测。

扫描游标绑定目录摘要、规范筛选条件和窗口起点；命中游标另绑定该窗口的正文快照与命中偏移。条件变化、目录/合法修订变化或当前窗口内容变化，均要求重新查询。更改页大小不改变筛选含义。`LOCAL_QUERY_STALE`表示旧绑定不可继续，`LOCAL_QUERY_INVALID`表示输入不合规，`LOCAL_SCAN_UNAVAILABLE`表示无法建立可靠目录观察；未知内部异常不向CLI输出原始路径或正文。

## 预算与覆盖状态

单窗最多尝试512份正文候选，最多接受2,097,152个完整序列化记录的UTF16代码单元。`content_units`计的是代码单元，不是UTF8字节、PCM字节或整次文件IO；一个在预算判断前读到的候选也可能占用一次scanned，但未被接受。日期过滤仍发生在有界记录读取之后，续扫用于到达后续窗口，不改变这项预算口径。

目录观察仍需全库元数据枚举和历史修订stat，未建立增量索引；原有MaterialStore.read在验证拆句来源时也可能读取父修订。因此不能称整次扫描最多2MiB IO、总共只读512个物理文件或已通过大库性能/功耗验收。

| 字段 | 解释 |
| --- | --- |
| catalog_total、window_start/end | 当前目录总量与本窗已前进的资料位置，不是原音覆盖或全库命中数 |
| scanned、content_units | 本窗正文读取尝试与已接受序列化UTF16量 |
| has_more、next_cursor | 本窗口内还有命中页 |
| scan_has_more、next_scan_cursor | 目录后面仍有资料未扫描 |
| unreadable、oversized | 本窗不可读取/验证、或单条超过预算而明确跳过的记录数 |
| stop_reason | end、scan_limit、text_limit或oversized；end只表示到本次目录尾部 |
| incomplete、incomplete_reason | 后续窗口、还有未扫资料、不可读或超预算时保留局部覆盖；原因优先oversized、unreadable，再window_only |

单条记录自身超预算时跳过并计oversized，允许继续到后续资料，避免永远卡在同一条；不会裁剪该记录后宣称已查询全文，也不会修改或删除原件。部分读取失败同样保留明确计数与不完整状态。transcription_state为partial的资料仍可查询当前已保存文字并继续扫描，partial不会因此变成完整转写。

## 正常页面与CLI

正常智记页的关键词/说话人/选中日期查询改用同一scan核心。页面分别提供“本窗口下一页”和“继续扫描后续资料”，显示资料位置、剩余窗口、不可读/超预算数量和窗口内排序边界。切换条件或日期、显式刷新及资料变更清除旧命中；从查询打开的旧正文同时失效。原时间线、普通详情、总结、回放和原有资料操作继续各自处理，不把一次状态刷新当作新查询。

schema1–10保留；schema11仅有`scan-local`，使用独立local_scan选择器和local_scan结果槽，不向旧local_query页增加字段。输入exact七字段为from、to、keyword、speaker、limit、scan_cursor、hit_cursor。首查两个游标均空；关键词或说话人至少一项非空；日期为两者均0，或from含/to不含、跨度最多366天。双游标类型不通用，旧`--cursor`及任务、卡片、开麦、确认、删除等其他功能参数不能混入，显式空值也不能绕过互斥。

以下命令从项目根目录执行，实际运行前须由开发者安装匹配debug候选、连接HDC并让App处于前台。本批仅验证Mock HDC，未执行这些手机命令。查询返回的片段属于私人资料，不应直接粘贴到公开日志。

```powershell
# 首次查询；保留最后一行控制回执，前一行是intent_saved元数据。
$first = @(python tools/phase1/io-card-cli.py scan-local --keyword '运费' --limit 10 | ForEach-Object { $_ | ConvertFrom-Json })[-1]
$first.local_scan

# 仅在回执complete且local_scan.has_more为true时，显式读取同一窗口的下一命中页。
python tools/phase1/io-card-cli.py scan-local --keyword '运费' --limit 10 --scan-cursor $first.local_scan.scan_cursor --hit-cursor $first.local_scan.next_cursor

# 需要切换窗口且local_scan.scan_has_more为true时，显式继续后续资料；本次不传hit_cursor。
python tools/phase1/io-card-cli.py scan-local --keyword '运费' --limit 10 --scan-cursor $first.local_scan.next_scan_cursor

# 只对账原命令，不再次扫描、翻页或重发；最新资料须另发显式查询。
python tools/phase1/io-card-cli.py reconcile --id $first.id
```

两种下一页命令是独立操作示例，不是自动遍历脚本。继续时须保留原日期、关键词、说话人条件，并始终使用对应回执内的游标。窗口切换会替换结果；未完成本窗口命中翻页就继续扫描，相当于主动离开当前窗口，不会后台替用户汇总。

命令上限仍为2,048字节，完整回执上限65,536字节；严格校验新21字段窗口DTO、最多10条命中及真实本机引用，超限拒绝，不截尾冒充成功。控制调用complete不表示全库已查全。reconcile仅读取冻结回执，不代表当前目录或业务最新状态。此入口不会开麦、发卡、恢复/提交Agent任务、调用模型、上传资料或删除文件。

## 验证范围与当前断点

以下是各自定向验证范围，可能相互重叠，不能相加作为产品验收数；最终以完整同源回归和原生构建账本为准。公开原始日志与原本机记录逐字节对应，失败与来源边界另见历史证据索引；这里只引用已经实际存在的证据。

| 范围 | 已观察结果 | 证据与边界 |
| --- | --- | --- |
| debug控制、Service及旧控制/待办兼容 | 71/71、terminal0 | [定向日志](../../rebuild/phase1/scan096-debug-targeted.log)与[原始记录](../../rebuild/phase1/scan096-debug-targeted-raw-run.json)；含真实Store＋Control到第513条、同窗命中分页、原文resolve、修订失效与原字节保持；未调用设备 |
| 新扫描核心＋旧查询 | 23/23、terminal0 | 新扫描8项和旧查询15项；[核心日志](../../rebuild/phase1/scan096-core-final.log)与[来源记录](../../rebuild/phase1/scan096-core-final-audit.json)，受控D盘真实IO及Node22；不等于真机性能 |
| 只读目录观察 | 19/19、terminal0 | [目录日志](../../rebuild/phase1/scan096-catalog-final.log)与[来源记录](../../rebuild/phase1/scan096-catalog-final-audit.json)；真实元数据/历史修订/链接和失效边界 |
| 正常页面＋旧查询/附注页 | 历史定向71/71 | [页面报告](../../rebuild/phase1/query096-page-host-2026-10-16.json)与[日志](../../rebuild/phase1/query096-page-host-native.log)；包含新页面7项，基于最终安全整数入口修正前的核心，只作历史定向证据，不能冒充最终同源整体验证 |
| Python CLI | 本批实际70/70、terminal0 | [0.1.96来源证明](../../rebuild/phase1/scan096-cli-source-validation-2026-10-16.json)及[原始终态日志](../../rebuild/phase1/scan096-cli-native-final.log)；旧schema1–10完整回归与新schema11均包含，真实本机intent＋Mock HDC，无实际手机/模型/网络 |
| 旧已保存总结页夹具修正 | 36/36、terminal0 | [真实目录接线报告](../../rebuild/phase1/scan096-saved-summary-fixture-2026-10-16.json)及[日志](../../rebuild/phase1/scan096-saved-summary-fixture-native.log)；仅测试夹具接真实MaterialStore.queryCatalog和Harmony数值lstat，不改生产/断言，不代替完整回归 |
| 完整App/来源快照 | final2 1952/1952、退出0 | [最终完整报告](../../rebuild/phase1/scan096-final2-source-validation-2026-10-16.json)为847份来源、测试期间不变且scratch清；来源快照见开头。首final 1951/1952失败仍保留，不由最终通过抹去 |
| 真实DevEco/签名/审计/留存 | 新run编译、官方验签、离线审计及留存均通过 | 新run`20261016-073924244-7e2cdad9`，3分47.598秒、terminal0、无fallback；官方验签true/退出0、847来源/6005载荷，HAP见开头。最终审计绑定同源；留存为84/96两物理签名包及核对硬链接、一份96源码stage，95已退役；首run小证据保留 |
| 安装/真机/人工/端到端 | 未做 | 最后实际验证安装84；无96原生页面可读性、容量响应/功耗或AC-QUERY结论 |

保留首次核心7/8失败及非法游标定点反例：不安全整数原先晚于目录访问才拒绝，已移到读取前的输入校验，不能把这类输入当普通来源过期。旧查询首次使用默认C盘TEMP时出现的Windows rename EPERM发生在夹具准备阶段，日志保留；后续受控D盘验证通过，不据此推断Windows故障根因。CLI首轮70项与仅修帮助文案后的最终70项均实际通过，来源和scratch分别留痕。

首完整回归唯一失败是旧journal-saved-summary用例在`assert(f.page.queryPage)`处失败：正常页改用续扫核心后，其旧VM夹具未提供真实catalog及所需lstat适配。原始[完整日志](../../rebuild/phase1/scan096-final-native.log)SHA256为`602d4b0f12dc8ebaa054a6d5b06229b199594a08e6aa7c8288506f1f825c4843`，首来源快照为`02e6833b8874e31cc984b6d0e6e69422d64930f7002c0c828929b30e179bd70a`。修正提交`b15df9f`保留原断言与真实页面方法，补齐真实目录端口后独立36项通过；该事实不能把原1951/1952改记为全绿；后续final2与新run分别重新完成完整回归和原生构建/验签，最终离线审计及留存绑定新run，不覆盖上述失败历史。

## 升级、后续及未完成项

本批查询不迁移或重写资料，但继承95的LocalWorkspace v2兼容边界。首次待办删除后，旧84仅支持v1的实现不能直接读取该v2 workspace；保留84包不等于迁移后可以无感回退，不能自动把data_v1_backup覆盖主文件，以免复活已删除待办或丢失后续稿件/对话。录音及canonical资料是独立存储，升级保留仍须设备重连后单独核对。

手机回来后由开发者依据已完成的审计和留存，先核对顶部96候选哈希、覆盖升级及原资料，再自动验证正常页查询、同窗翻页、后续窗口、来源更正/删除失效和原文入口；必要实际页面可读性归已有H04集中验收，不让用户制造数据库故障。尚无新的人工硬件结果，不能关闭P24整体、正式BASE或AC-QUERY。

下一独立场景先处理资料outbox最多1,000行的安全水位与归档。[真实本机容量观察](../../rebuild/phase1/material-outbox-capacity-observation-context-2026-10-16.json)以1001份合成资料、1000条明确合成ACK复现第1001份OUTBOX_FULL，以及随后EOF清除警告的状态；没有真实云端ACK、设备或网络调用，不属于96修复。口述来源128条及跨principal/活动引用/已完成来源的安全退休随后独立设计。本批没有增大这些上限、清理收据、修改outbox或处理用户资料。H07短时建议卡两分钟未修、有效有声口述/可靠退出及完整答案回原任务仍开放，未以本机资料续扫替代这些验收。
