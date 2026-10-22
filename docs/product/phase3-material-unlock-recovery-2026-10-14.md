# P31/P32：前台凭据暂不可读后的有界恢复

日期：2026-10-14；起点为0.1.60删除批次提交 `a70b39e`，本批候选0.1.61/10061。按[开发顺序](./DEVELOPMENT-PLAN.md)修复一个实际前台恢复缺口，复用现有Asset凭据、资料同步Service、Coordinator和持久outbox，不更换资料契约或服务器身份。

首候选已通过专项35项、完整App801项和真实编译，但最终独立审查发现保存跨dispose/reinitialize的P2；最小补救、29项定向绿例及定点复审已收口。修复后的完整App805/805、真实编译44.401秒及签名45.448秒通过，已覆盖安装并读回10061。三轮真实锁屏/解锁后，同PID的Service自动重试恢复；正常页仍残留旧配置错误提示，整页恢复及新云消息出口尚未关闭。首候选没有签名或安装，不作为最终包，定时器替身与原生结果分别登记。

## 实际问题与本批范围

[上一批普通删除记录](./phase2-normal-deletion-2026-10-14.md)保留真实观察：前台恢复先读取锁屏受限Asset失败，同步显示配置暂不可读；解锁后普通设置能读回既有开启配置，但同一次前台的Service没有再次读取。只有Home→Entry再次进入前台，手机才自动补发原第2版合成墓碑并获得云端确认。该操作不是自动重试修复的验收。

既有`SecureMaterialSyncSettings`将真正缺失的Asset或空查询解释为默认关闭，将其他Asset查询失败映射为`SYNC_SETTINGS_UNAVAILABLE`；解析/校验失败为`SYNC_SETTINGS_INVALID`。本批只在Service遇到暂不可读时增加前台有界重试，不修改健康的普通设置Panel.load，不要求用户重新保存开关或输入新凭据。暂不可读不等同凭据缺失，也不能据此覆盖原配置。

修改集中在`MaterialSyncService.ets`及新增源码事件回归。原材料、修订、删除墓碑和回执继续沿用原耐久路径。本批没有新凭据发行、自动轮换、后台定时同步、原音上传或服务器改动。

## 恢复策略与并发边界

初次前台读取仍按既有流程执行；仅捕获`SYNC_SETTINGS_UNAVAILABLE`后安排一个计时器，最多重试5次，每次等待依次为1、3、10、30、30秒。含初次读取最多6次Asset查询；计时等待合计74秒，不包含Asset读取和旧writer停止所需时间，不承诺74秒内一定恢复。持续失败到预算上限后保留提示和既有保存配置，不无限循环。明确reload或新一轮前台可重新开始预算。

| 条件 | 实际策略 |
| --- | --- |
| 前台暂不可读 | 先暂停当前Coordinator配置，再重读原Asset；只有既有配置有效且enabled时才配置其原目标。成功清理计时器/尝试计数/暂不可读提示 |
| 真正缺失或空Asset | 默认关闭，不重试，不发明服务器身份或凭据 |
| 损坏配置、校验或Coordinator失败 | 保留失败状态，不按锁屏临时失败无限重试；只对暂不可读错误安排有界计时 |
| 退到后台 | 取消计时器，停止自动凭据重试，并使旧异步读取代次失效。既有显式保存事务按其原语义完成，避免保存跨前后台时被静默丢弃 |
| 明确保存/关闭/换目标 | 保存开始前取消旧重试并推进generation；晚到的旧读取不能重新启用原目标，保存失败保持暂停 |
| 手动reload、新一轮前台 | 取消旧计时并重置预算；已排入平台回调队列的旧计时器不能清掉新计时器或写入新代次 |
| dispose及重新initialize | 取消计时器并使旧代次失效；新Coordinator等待旧关闭完成，旧读取或回调不能配置新运行时 |

计时回调同时检查foreground、saving、Coordinator对象、generation及计时器身份；每个await后仍核对代次。显式reload在后台可以沿用既有读取接口，但不会安排后台自动重试。恢复只是重新读取已有用户配置，不能绕过其关闭决定、身份校验或现有outbox的失败状态。

审查P2的最小补救另记录被saving跳过的新前台运行时及代次。只有vault保存确已成功、当前仍是该新Coordinator/代次、仍在前台且保存来自旧运行时时，save的finally补一次reload；该读取仍等待旧closing。保存失败、同一运行时或已退后台均不补读，不自动恢复旧凭据。此补救不是扩大锁屏重试次数，也不绕过显式关闭配置。

hilog仅记录尝试次数、等待毫秒和恢复发生于第几次尝试，不记录令牌、地址、身份、正文或密码。正常健康加载没有重试事件；日志写失败由局部catch隔离，不能阻断重试或恢复。

## 当前验证分级

| 层级 | 已取得的结果与边界 |
| --- | --- |
| 旧基线红例 | `material-sync-reload-recovery-red-2026-10-14.log`：旧Service没有预期恢复计时器，1项失败。是本机旧行为复现，不改写上一批实际手动foreground恢复 |
| 隔离候选 | `material-sync-reload-recovery-green-2026-10-14.log`：17/17，通过仅在内存应用受源码上下文保护的patch；旧源码字节保留。Asset、计时器、Coordinator/网络均为明确替身，不是手机实验 |
| 集成专项 | 宿主Node22专项35/35：新增Service恢复18、原Service4、Settings3、Coordinator10。覆盖同次前台恢复、次数上限、缺失/损坏区分、保存与代次/后台/销毁竞态及非敏感日志；不按测试数量计算产品进度 |
| 保留失败尝试 | 同一专项首次sandbox运行25通过/10失败，Coordinator真实临时文件原子rename出现EPERM，原日志保留；没有将失败计为通过。宿主专项成功日志另存 |
| 首候选完整App回归 | 801/801、零失败/跳过/取消，151003.3748毫秒；35为相关专项，不与801相加。该回归早于最终审查P2补救，不代表补救后的源码 |
| 首候选DevEco编译 | 实际64.390秒、wrapper complete、compileSucceeded=true、fallbackUsed=false；未签名未安装。此构建不能作为审查修复后的最终包 |
| P2定向红/绿 | 新增4项先在旧代码上2通过/2失败；最小补救后新增Service22、原Service4、Settings3合计29/29，最终绿日志另存。原35含Coordinator10而本轮29不含，不能把两个数量相加。Asset与计时器为替身，未操作手机 |
| 最终定点复审 | 原P2关闭；独立重演保存成功/失败和等待旧closing的时间线，在该定点范围未发现新增P1/P2。不代表真机生命周期竞态或全部App无缺陷 |
| 最终完整App回归 | 修复后805/805、零失败/跳过/取消，129703.967毫秒；新22、最终专项29和旧专项35均按对应源码/范围登记，不相加计算验收 |
| 最终DevEco编译/签名 | 实际编译44.401秒、wrapper complete、compileSucceeded=true、fallbackUsed=false；签名assemble45.448秒通过，最终签名包另行绑定 |
| 覆盖安装/版本读回 | 覆盖安装实际成功，设备0.1.61/10061；安装前采集/ASR空闲，PID34256→52502，未卸载或清资料 |
| 真机Service同次前台恢复 | 三轮真实systemLocked=true→观察到系统键盘并解锁，同PID下原生日志均为retry attempt1/delay1000→recovered1，前台同步恢复；无保存或切换开关，非模拟错误 |
| 正常页残留 | Service已恢复，但旧settingsNote提示仍显示；Panel.refresh未撤销旧提示。当前不能写整页错误已清，下一0.1.62独立修提示归属 |
| 手机到云端出口 | 目前累计32个已存版本、0待同步/0问题；不是本批新上传32份。新资料消息及其恢复后回执/CLI出口未验证，不用Service恢复或旧回执推断新server_stored |

专项日志：[宿主35项](../../rebuild/phase1/material-sync-reload-recovery-061-specialist-host.log)、[sandbox失败尝试](../../rebuild/phase1/material-sync-reload-recovery-061-specialist.log)、[旧基线红例](../../rebuild/phase1/material-sync-reload-recovery-red-2026-10-14.log)、[隔离17项](../../rebuild/phase1/material-sync-reload-recovery-green-2026-10-14.log)。首候选源码/测试已逐字节读回核对：Service SHA256 `5ce64b4c5bc581ad630aca5ebbd3aa925f52e03ad0768681040dd61d37b70f6e`；新增测试 `99b1e68382616793ddf36c888de2926df01cf66c57a7e15b500b46c075a8944c`。这些哈希只绑定首候选，不代表随后P2补救后的源码。

首候选build run `20261014-072526910-44d551ea`，source manifest SHA256 `9dc3d30964488b86ec6ac80fd5fa9ab6ba0c9a4b66a5f90da3a2328a02c8f29f`；[801项完整日志](../../rebuild/phase1/material-reload-app-regression-frozen-2026-10-14.log)及该run的构建状态保留。独立复审随后发现：save等待Asset期间发生dispose/reinitialize，新前台reload因saving跳过，save的finally没有补新运行时读取，导致开启配置已保存而新Coordinator仍暂停。这是首候选未覆盖的并发组合，不能因801通过宣称无P1/P2。

P2补救证据：[4项红例](../../rebuild/phase1/material-sync-reload-recovery-061-p2-red.log)、[第一轮29项绿例](../../rebuild/phase1/material-sync-reload-recovery-061-p2-green.log)、[最终29项绿例](../../rebuild/phase1/material-sync-reload-recovery-061-p2-final-green.log)。补救后冻结Service SHA256 `7b7ea77bdc6d7690721617d0ce2db28066f4cf028e7d70155b04036ff2b4be98`；测试 `3736551ecbebab6f686d8050c1034f8b8ce953e5e537a3d4418a5cf21c7a2bc7`，已从实际文件独立读回匹配。[最终805项完整日志](../../rebuild/phase1/material-reload-061-app-regression-final-2026-10-14.log)另存，不覆盖首801记录。

最终构建run `20261014-073217984-50049d69`，source manifest SHA256 `5af0135127d6bffc7854114ced9082cd6bc1dfc81072a1f0cb5bcd058db70355`；状态文件和build.log实际读回一致。未签名HAP447327929 bytes，SHA256 `3deec3841415eca8618497e1eb0c79b81ef16bf4d58a7ad4b7ddb7d9b4879c39`。这些是未签名产物数据，不代替签名包哈希、覆盖安装及设备版本确认。

最终签名HAP448527814 bytes，SHA256 `2e86465bc444bcb26cc19ebb6a0e278a6e549cefdb2c2f8c406ce74fb16302e5`。三轮原生重试/恢复时刻（北京时间）分别为07:39:16.041→07:39:17.110、07:39:33.480→07:39:34.542、07:39:51.987→07:39:53.049；恢复日志仅含次数元数据。原生自动重试结果仅限Service层，保存跨dispose/reinitialize的P2实际生命周期竞态仍只有本机/定点复审证据。

公开报告：[material-reload061-native-device-2026-10-14.json](../../rebuild/phase1/material-reload061-native-device-2026-10-14.json)；复核脚本：[summarize-material-reload061-device.mjs](../../tools/phase1/summarize-material-reload061-device.mjs)。本批独立只读审查后已用项目Node22重放脚本，5份源码/final manifest/签名HAP、安装版本、真实系统锁状态、6行同PID原生日志、前台布局和残留提示均断言通过。无设置保存、无驱动写入凭据/资料来自实际操作ledger，不扩大成完整输入事件日志；原始系统键盘布局、凭据或密码不公开。脚本不联网、不操作手机或制造回复，只从既有文件生成白名单元数据。

保护资料实际读回并经脚本核对：第10版canonical SHA256 `83248d4c6b50ed750875be3fb52b5907cc0e5d823aaed9d5b5e8d1687bfed6a5`、原音 `cd2ba1e3a85dfb445fed45ec8bf5c0d29acd261a579349c9bcedc5462e0477e1`、原ASR `97c7ae1b6e397343cca293a833598a0011edce2751fb7f9f91f17e1169679cc1`，与上一批公开哈希逐项一致。整个既有outbox与0.1.60冷启后账本逐字节相同；不扩为所有手机文件保全，不据此宣称期间没有网络重试包。

## 开放边界与后续

本批白名单证据核对已完成；下一0.1.62独立修复正常Panel的旧配置提示归属，分别验证Service状态及可见提示一致，不能把0.1.61的Service已恢复扩大为整页无错误。原材料及上一批第10版校正样本继续保留。

本批不关闭正常正式配置的断网/积压恢复、自动凭据轮换、平台后台网络资格、8小时/功耗、原音归档/回放或整阶段P31/P32验收。RecordingPanel独立真机删除、每日总结修订绑定、最新导出/汇总、真实双人与自动“我”、Hermes正式skill及任务端到端按[当前入口](./DEVELOPMENT-STATUS.md)分别推进；官方BASE完整对齐要求保持。P13未批准不批量重写页面，Excel仅在用户明确要求时更新。
