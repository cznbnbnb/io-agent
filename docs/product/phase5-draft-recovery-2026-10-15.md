# P51/P53/P54：中断草稿的明确选择恢复

日期：2026-10-15，源码提交`cc3c153`，候选版本 **0.1.87/10087**，已构建/签名、未安装。本批沿用[0.1.86答案保护](./phase5-answer-durability-2026-10-15.md)，只补本地中断记录的恢复出口，不改线上协议、原厂固件、停止门禁或正式验收标准。手机最后实际安装仍为0.1.84；用户准备断开手机，本批不操作设备，Excel不动。

## 场景及实现

正常保存失败留下`task-decision-draft.json.partial`时，0.1.86保留主记录和中断记录并禁止提交，但没有安全恢复按钮。现在正常答复面板可分别预览两份有效记录中的原问题和完整正文，再明确选择其中一份。仅预览也可用于复制已过期、已结案或已有发送记录的内容；它不表示还能恢复或重新回答。CLI只返回有界元数据和字节哈希，不返回正文、问题、身份或会话路径。

恢复不按时间戳猜选，不拼接两个不同请求，不保留旧的发送确认或收音授权。选中review/sealed恢复为暂停review，选项确认清除、来源标为phone；voice_authorized退回需再次同意的supplement_offer。已入队或撤回的来源只读，已有同operation的任何outbox记录也禁止重新制造答案。检查完整邮箱，不只检查界面最近20条。原请求、修订、电脑/Agent/项目/会话和原期限保持，恢复后的正常业务继续入口仍需重新核对原请求。

同一完整绑定的UID使用历史取并集；唯一清理义务保持。两个不同绑定、冲突清理UID/眼镜/卡阶段、超过8个UID或超出保存上限时只读保护，不通过删UID、换会话或截断全文强行恢复。恢复操作先使旧回调失效，不发送卡片、移除、收音、答案或任务取消。原有UID移除仍是之后的独立清理职责。

## 文件事务及边界

1. 原始文件按实际字节读取、SHA256核对；短读、无效UTF8和长度变化不被替换字符串掩盖。预览只读完整有效来源，原始字节始终保留。
2. 用户选择绑定当前inspection哈希。再核对当前context、前台/空闲、原请求、期限和完整outbox后，用独占`task-decision-recovery.active`目录占位。草稿初始化及所有发布前检查从空目录起就阻断旧写入者，不能在主文件暂时移走时误建新问题。
3. 不可变intent绑定两份原件存在性/字节数/哈希、选中来源、原绑定及归一化结果。原件改名归档到`task-decision-recovery-cases/recover-<32hex>/`；准备文件验证后才成为主记录，写完成账本后归档active目录，最后重新读取为暂停草稿。
4. 7处改名前后中断可通过当前inspection哈希和`resume`显式续完。已经持久开始的事务不因之后请求过期、关闭或新增outbox而卡在半途；只完成本地文件事务，仍保持同context、精确字节和暂停，不绕过后续业务校验。
5. 损坏/未知intent、归档被改动、不完整生成文件、未知文件或目录保持只读，不猜测回滚、不覆盖旧备份。完整的intent/ready/done中间文件可以核对后继续；截断或损坏的中间文件不自动重建。没有实现任意损坏文件修复，也未验证真实断电持久性。

每份来源及归一化目标最多256KiB；UID合并后的实际UTF8大小必须在创建active之前检查。每案最多1MiB、最多4案/合计4MiB。达到边界只拒绝新恢复，不自动清理任何旧案；未知目录和用户其他资料不在清理范围内。active未结清时不得回退到不认识该保护目录的旧包继续写草稿；保留旧安装包不代表中间记录可被旧版安全处理。

## CLI

继续使用[io-card-cli.py](../../tools/phase1/io-card-cli.py)，仅debug构建启用原有私有收件箱；正常页面和CLI调用同一个恢复服务：

```powershell
python tools/phase1/io-card-cli.py recovery-status --device <设备ID>
python tools/phase1/io-card-cli.py recovery-restore --device <设备ID> --recovery-source partial --recovery-binding-sha256 <刚查询到的64位哈希>
```

`recovery_source`仅main/partial/resume，客户端及App均拒绝混用schema/语音/卡片字段、任意路径或正文注入。schema4精确8字段，沿用60秒命令期限和持久claim；同ID及冷启动running不重放。传输回复丢失时先用既有reconcile原ID收取冻结结果，再查询当前状态，不能重新生成恢复命令猜测已完成。控制调用完成只代表本地恢复调用，不代表已提交答案、服务器接受、Agent接收或原任务完成。

## 验证分级

最终完整App **1235/1235通过**，800份来源在测试期间保持，快照`6be0dccfbc8506527fd733f7f6477c58af070b73164102868dda0136366d870d`，D盘受控临时目录已回收，见[final2摘要](../../rebuild/phase1/recovery087-final2-source-validation-2026-10-15.json)及[原日志](../../rebuild/phase1/recovery087-final2-native.log)。[Python CLI单元测试](../../rebuild/phase1/recovery087-python-cli.log)20/20通过，传输全部mock，未调用HDC。恢复测试独立注入支持fatal的真实TextDecoder，并以JSON字符串内无效UTF8反例验证拒绝替换字符；不是只传递一个被旧宿主替身忽略的参数。

真实DevEco构建run`20261015-221920120-c1da8978`通过，1分37.405秒，`compileExitCode=0`、`fallbackUsed=false`；见[构建记录](../../rebuild/phase1/candidate-runs/20261015-221920120-c1da8978/status.json)。官方原生验签及6005项产品载荷核对通过，475788631字节，SHA256 `35184b8e5550a29d1e91d5e78afda02d6de522cb91511f1223bd877d04731477`，见[签名证明](../../rebuild/phase1/candidate-runs/20261015-221920120-c1da8978/sign-finalization-status.json)。800份测试/构建来源同一快照；回收后再次逐文件和实际HAP哈希复核通过，[离线交付审计](../../rebuild/phase1/recovery087-source-audit-offline-2026-10-15.json)。本批未安装；回归、编译、签名和文件故障注入不能代替真机系统文件API、界面交互、真实存储故障或端到端验收。

已完成[两包/单暂存留存](../../rebuild/phase1/recovery087-offline-retention-2026-10-15.json)：保留最后实际安装84及待安装87两份物理签名包，版本别名为核对过的硬链接；只留87源码暂存，旧86包/暂存和87可生成输出均已回收，未创建大归档或查询设备。冻结未签名输入已退役，本run不能重新签名。回收后C约51.71GiB、D468.23GiB可用，用户资料、原音、凭据及原始研究材料保持。

首套完整App回归[1234/1234通过](../../rebuild/phase1/recovery087-final-source-validation-2026-10-15.json)，799份来源保持，原结果不覆盖。随后根代理在服务接线审查发现：冷恢复重新显露清理UID后只刷新UI，未刷新共享占用，独立收音或通知可能误判眼镜空闲。独立单例红测1/1失败已复现；最小修复让恢复通知经过原占用回调，相关测试1/1通过。故首套通过不足以代表最终来源，新增整合回归后另做final2完整验证。[红测](../../rebuild/phase1/recovery087-occupancy-red.log)和[修复后定向](../../rebuild/phase1/recovery087-occupancy-green.log)分别保留。

首版恢复测试实际54项中50通过、4失败（含父项汇总，实际3个失败分支）：完整中间文件继续时，Windows只读句柄`fsync`报EPERM。随后改为无CREATE/TRUNC的可写句柄同步、关闭后重核原字节再改名，54项复验通过。首次失败由测试Agent的工具终态记录，未生成可链接的完整原日志，本节不追造日志或SHA。

独立审查另发现两份各自有效的来源合并UID后可能超过256KiB，在创建active后才拒绝会留下无效intent；本批改为统一归一化尺寸门禁，并补原件不动、无active产生的反例。UI changed异常亦不能掩盖已完成的本地事务。SDK未知catch类型重抛在真实构建前改成明确Error类型；不将这一静态预防写作本批曾真实编译失败。

下一设备出口仍按[集中人工清单](./USER-VERIFICATION-TODO.md)的H07-V02有效口述、H07-C01完整确认及H07-T01两分钟连续可读执行。本批不要求用户制造磁盘故障、重复头势或朗读；可自动化的恢复检查继续独立完成。整段语音及可靠退出仍未通过，原厂固定提示时长问题也未修复。
