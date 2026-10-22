# P24：已保存总结的人工附注

日期：2026-10-16，当前实现候选0.1.91/10091。按[PRD 7.3、7.5](./PRD.md)及[开发计划P24](./DEVELOPMENT-PLAN.md)，沿用[0.1.90已保存总结重开](./phase2-saved-summary-reopen-2026-10-16.md)，新增人工附注、版本保存、重新打开和Markdown/JSON导出。复用实际资料、总结与导出链路，未改录音、转写、模型和Agent协议。

**当前源码`bb724ca`（功能首提交`c83263e`），0.1.91/10091已构建、签名及离线来源审计，未安装。** 修正真实DevEco发现的两处ArkTS类型兼容问题后，完整App final2为1547/1547；814份测试/编译来源一致，快照SHA256为`393bf253f3dd62bbb4740cb50c6d2870c98404ca91a427299d79257ba33a684e`，测试暂存已清理。CLI45项Mock HDC的两个Python文件未变。run`20261016-022412689-2feb529e`官方验签及6005项载荷核对通过；签名包SHA256为`50bad90d5063f627d4a1f8d28fe14922d0afb773522beddc16b615c8ab9e1d87`。最终保留84已装/91待装两物理包与硬链接、一份91源码暂存；失败及旧90的可重建暂存、未签名包和生成物已回收，小型证据保留。手机最后验证安装84，本批没有设备、App业务联网或模型调用，不更新Excel。P24/BASE整体、附注服务器同步、镜片、完整语音及连续两分钟建议卡等出口保持开放。

## 用户操作与保存含义

在智记页选择日期，打开来源已核对的总结后，可另外填写人工附注。原AI正文保留原样，生成时间和模型仍按旧文件记录为未知；新增保存时间只说明这次人工附注。页面注明附注仅保存在本机，不能解释为服务器已存储或电脑Agent已收到。

附注使用独立编辑区，不替换普通记录正文、关键词查询或AI总结。版本按可读的本机记录时间及保存状态辨识，不以随机操作串作为主文。记录时间在显式续完时保持，表示建立人工记录的时刻，不能当成AI生成时间或另一个最终提交时间。一个尚未提交的编辑槽绑定原总结引用、来源指纹、操作ID及完整输入；切换日期、关闭总结或收到资料变化通知时不自动丢弃输入。尝试保存后固定同一次完整输入，结果不确定时先对账；修改内容须明确处理旧草稿并使用新操作ID。只保留一个过程编辑槽，避免无限缓存。

**未点击保存的输入只保留在当前App进程内**，本批不承诺进程被杀或重启后恢复这部分输入。完整待提交文件和已提交版本另有持久记录。未保存输入的跨进程自动草稿仍是正式日用质量缺口，不能与已保存版本的冷重开混为一谈。

已保存附注可按日期查找、打开；再次编辑以原不可变总结为基准，记录上一附注的完整引用，另存新版本。旧版本不改写，自动日缓存更新也不覆盖人工附注。保存前来源更正、删除、不可读取或原缓存被替换时拒绝绑定旧输入，不把旧总结重新贴上新来源指纹。

## 持久化与失败恢复

正常页与CLI共用`JournalSummaryNotes`。操作ID包含严格日期和随机后缀，按日期及操作划分目录；文件引用包含完整内容SHA256，不接收任意路径。只读列表有分页、扫描与文字预算，覆盖不完整时明确说明，不把后续日期挡在全局历史条数之后。

首次保存用独占目录保留该操作，核对原总结和当前来源，并冻结原总结的不可变快照。人工记录分离原引用、冻结引用、来源指纹、完整附注、输入摘要、人工保存时间及上一版本引用。短写循环、fsync和最终改名分别检查；成功回执仅表示该本机版本提交成功。

同操作同输入返回原引用，异输入冲突；完整待提交文件必须显式续完，不能因重试或App重开自动应用。完整但尚未提交的附注可先只读恢复全文，重新核对来源后再明确续完。审查补上续完的持久化缺口：以仅写模式打开现有pending，不CREATE/TRUNC或重写正文，成功fsync并重新核对文件及来源后才能改名提交；失败仍保留原字节及记录时间，文件可读不能代替持久化成功。空占位、截断、损坏及未知文件不覆盖、不猜测恢复，也不自动清理。

每次读取、分段或导出都验证实际附注文件与冻结总结及当前来源。来源已删除或无法核对时，目录只返回状态，不能通过附注重新打开旧AI正文或旧附注。导出保留原AI文档，另加明确的“用户附注”；JSON分开记录原文、人工内容及引用，不伪造AI生成来源。

导出使用独立内容摘要快照，避免污染0.1.90的总结目录。系统文件选择器返回后，在打开或清空目标文件前再次核对完整引用和来源；后续复制只检查轻量页面状态，收到变化后停止，不宣称已经写出的部分被回滚。

## CLI与传输边界

新增schema7的保存、显式续完、状态、列表、已保存全文分段及待提交输入读取。schemas1–6保持。完整附注上限8192个UTF16单位，正文附件上限65536字节；CLI命令仍受2048字节约束，App结果仍受65536字节约束，不截断正文以适应命令。

正文先在本机持久记录，再传固定命名附件，最后传命令；App按原始字节摘要、操作及原引用核对后才调用共享核心。附件失败不发送命令；命令传输一旦尝试，后续先用原ID对账，不自动重投。效果已发生但回执丢失时，按同操作完整输入核对原版本。“已保存”只由相应回执证明；操作错误或损坏/未知证据不能默认写成“未保存”。

App附件清理在持久终态回执之后，仅处理同ID且哈希仍匹配的附件。电脑端生成的完整输入副本更保守：确认同操作、同完整输入已保存后才清理；待续、错误和未知结果保留输入及操作标识，不删除用户传入的原文件。未知附件不扫描删除。

App附件数量/总量设门禁；CLI在新目录/上传之前，也以同设备操作系统锁、有界库存核对及128附件/8MiB预算限制本机已知积压，无法核对则关闭新上传。已确认成功后的生成副本清理失败仍计占用，不改变保存结论。CLI现有传输接口无法可靠读取远端库存；其他电脑或其他来源留下的远端孤儿仍可能先上传后被App处理门禁拒绝，这一缺口保留，不能声称完整解决积压清理。命令和结果只解释本地附注状态，不代表眼镜显示、服务器存储或Agent任务完成。

容量和效果审查另补两点：未确认传输不能不断新增本地正文副本，第129个附件在新目录、写入或上传前拒绝；`annotation_saved`为三态，只在验证saved回执后为true，已验证missing/reserved/pending/stale为false，错误、blocked/corrupt或缺回执为null。改名已成功但后续读回失败的结果仍不确定，不能标为确定未保存，也不能删除用于对账的完整输入副本。

正文按完整引用和UTF16偏移分段；调用方须保持同一引用并按`has_more/next_offset`继续，不能拼接两个版本。MD、JSON及显式待提交输入都可能含私人资料；不会自动上传到服务器或模型。开发证据使用合成内容。

以下参数已直接核对当前CLI解析器，示例本批未执行。变量须换成实际目录/状态返回值；`$textFile`是用户提供的UTF8纯文本文件，不是JSON。

```powershell
python tools/phase1/io-card-cli.py list-summary-notes --note-day 2026-10-15
python tools/phase1/io-card-cli.py save-summary-note --note-operation-id $op --note-day $day --note-file $textFile --note-parent-id $parentId --note-parent-sha256 $parentSha --note-source-sha256 $sourceSha
python tools/phase1/io-card-cli.py summary-note-status --note-operation-id $op
python tools/phase1/io-card-cli.py read-summary-note --note-day $day --note-id $noteId --note-sha256 $noteSha --note-format json --note-offset 0 --note-max-chars 4000
```

`$op`必须是`noteop-YYYY-MM-DD-<32位小写十六进制>`，日期与父总结一致。父总结ID/全文摘要及来源摘要来自实际已验证总结，不能凭空填写。编辑旧附注时成对提供`--note-previous-id/--note-previous-sha256`；优先以其不可变origin为父引用。命令结果不确定先用`reconcile --id <原dbg命令ID>`对账，不重发。完整pending可用`read-summary-note-pending --note-operation-id $op --note-input-sha256 $inputSha`只读恢复；明确续完使用`resume-summary-note`，必须保持原操作ID、正文文件内容及全部绑定参数，不自动生成新操作代替旧保存。

## 验证出口

| 层级 | 当前事实 |
| --- | --- |
| 实现 | 核心、正常页、debug及CLI本批来源已冻结，未安装 |
| 核心、页面与debug | 核心39、[页面33](../../rebuild/phase1/summary-notes091-page-final3.log)、[类型修正后的debug47](../../rebuild/phase1/summary-notes091-debug-arkts-filter-final.log)均通过且已被final2完整App套件覆盖；这些是其子集，不能相加当产品验收。实际旧总结/资料模块、D盘文件及IO故障为真实宿主检查，平台/UI/选择器为明确替身 |
| 完整App/来源报告 | 修正后[final2的1547/1547、退出0](../../rebuild/phase1/summarynotes091-final2-source-validation-2026-10-16.json)及[日志](../../rebuild/phase1/summarynotes091-final2-native.log)，814来源未变、scratch已清理；首轮[报告](../../rebuild/phase1/summarynotes091-final-source-validation-2026-10-16.json)和[日志](../../rebuild/phase1/summarynotes091-final-native.log)保留。文件名中的native指宿主执行，不代表DevEco编译 |
| CLI | [45/45 Mock HDC、退出0](../../rebuild/phase1/summarynotes091-cli-source-validation-2026-10-16.json)，两份Python来源未变、scratch清理true；[原始日志](../../rebuild/phase1/summarynotes091-cli-native-final.log)。没有真实HDC传输，不与App项数相加当端到端通过 |
| DevEco/签名/载荷/留存 | 新run`20261016-022412689-2feb529e`真实DevEco编译2分42.087秒、无fallback、终态0；官方验签及6005载荷通过。[签名终态](../../rebuild/phase1/candidate-runs/20261016-022412689-2feb529e/sign-finalization-status.json)、[来源审计](../../rebuild/phase1/summarynotes091-source-audit-offline-2026-10-16.json)和[两包一暂存留存](../../rebuild/phase1/summarynotes091-offline-retention-2026-10-16.json)均完成；保留当前84和待装91，版本别名是硬链接，同run未签名输入已退役，不能再次签名 |
| 手机/人工/端到端 | 未做，候选未安装；必要界面体验已登记H04，设备重连后集中验收 |

原始失败与修正记录保留，不覆盖旧日志：[页面首轮29/30](../../rebuild/phase1/summary-notes091-page-first.log)的夹具在列表关闭正文后未重新打开即尝试编辑；[时间显示首轮32/33](../../rebuild/phase1/summary-notes091-page-final2.log)把切换测试时区与后续页面日期绑定混用，现隔离并还原时区。[CLI首轮39项、2失败3异常](../../rebuild/phase1/summary-notes091-card-cli-first.log)包含Windows换行夹具与全空白控制字符样本的无效预期；修正后逐批增加容量、锁、未知效果和清理检查，最终45项通过。核心初轮37/37及补强后的39/39原日志留在`rebuild/phase1/device-private/summary-notes091-core-{first,final}.log`，没有将fsync恢复审查虚写为已有真机掉电试验。所有宿主失败注入都不证明物理断电或真实手机磁盘故障已通过。

首轮真实DevEco run`20261016-021004702-178ab254`编译失败：`Object.keys(row||{})`触发未声明对象字面量，两个独立Filter类强转触发结构类型禁用。[终态](../../rebuild/phase1/candidate-runs/20261016-021004702-178ab254/status.json)与[原始日志](../../rebuild/phase1/candidate-runs/20261016-021004702-178ab254/build.log)保留；最小修正为先判空、显式建立目标Filter并保留原三键校验，核心39及debug47重新通过，再执行final2完整回归与新run，未修补失败暂存冒充重构建。

首次失败批次的1,118,244,760字节可重建暂存已按精确终态、814来源及84/90保留包哈希核对后回收，[清理账本](../../rebuild/phase1/summarynotes091-failed-run-cleanup-2026-10-16.json)为complete；不删除失败来源清单或原始日志，也未制造大归档。新批次结果以上表及独立审计为准。

总结原文编辑、事实/候选/问题/建议分类折叠、长文模型、附注服务器同步、正式8小时/功耗及覆盖升级仍按完整PRD出口推进，不以本批附注入口代替这些能力。
