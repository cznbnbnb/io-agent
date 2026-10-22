# P31/P32：同步恢复后撤销旧Service提示

日期：2026-10-14；起点为0.1.61提交 `ba578ea`，本批0.1.62/10062已覆盖安装。延续[前台凭据恢复批次](./phase3-material-unlock-recovery-2026-10-14.md)，仅修普通同步Panel的消息显示归属，不修改凭据读取、Service重试、同步队列或服务器。

代码和相关页面事件25/25已通过，实际编译40.637秒、签名46.461秒及覆盖安装成功；三轮真实锁屏/解锁后，Service恢复且每轮普通页旧错误提示均撤销。0.1.61的805项完整回归是此前冻结结果，本批没有运行或宣称0.1.62完整817项通过。

## 实际问题与最小修改

0.1.61三轮真实锁屏/解锁后，同PID的Service自动重试已恢复，普通页显示前台同步，整个既有outbox保留，但页面仍显示“同步配置暂不可读，请解锁后重试；未覆盖已保存配置”。原`refresh`只在Service.settingsNote非空时复制提示，没有在Service清空后撤销旧提示。

`MaterialSyncPanel.ets`只新增`lastServiceNote`并修改`refresh`，继续刷新summary及problems。仅当Service提示文本发生变化时处理消息：新非空提示可以显示；Service清空提示时，只有页面note仍等于前一次Service提示才清空。页面已改为导入、草稿、取消、保存或自身读取结果的反馈时，恢复不会误删这些反馈；同一个Service错误的重复通知也不再次覆盖它们。新的不同Service错误仍可展示，不承诺所有错误永远不能更新操作反馈。

本批不调用新Asset读取、identity预检、取消、保存或同步动作，不改健康Panel.load及既有耐久保存流程。Service SHA保持上一批冻结值，1/3/10/30/30秒有界重试及保存跨生命周期补读仍沿用0.1.61，不把页面文字修复当成新增连接能力。

## 代码与本机验证

| 层级 | 结果及范围 |
| --- | --- |
| 定点只读审查 | 业务diff仅`lastServiceNote`与`refresh`；在此消息归属范围未发现新增P1/P2，不等于全部App无缺陷 |
| 旧基线红例 | 同一新增12项在旧Panel上6通过/6失败；红日志保留，没有将失败写为通过 |
| 修复后新增事件 | 12/12，覆盖撤销旧Service提示、重复错误与恢复保护草稿/导入/取消/保存反馈、健康load和自身load失败、不同新错误及重新出现 |
| 相关回归 | 旧Panel事件13+新12合计25/25，零失败/跳过/取消；实际页面方法经DevEco TypeScript转译执行，平台、Service和网络为明确替身，不是ArkUI/native/公网验收 |
| 完整App | 0.1.61冻结805保持历史；本批采用相关25项、真实编译及真机验证，没有0.1.62完整817项结果，不相加折算产品进度 |
| DevEco编译/签名 | 实际编译40.637秒、wrapper complete、compileSucceeded=true、fallbackUsed=false；签名assemble46.461秒，HAP及最终manifest另行绑定 |
| 覆盖安装/版本读回 | 实际覆盖安装成功，设备versionName=0.1.62、versionCode=10062；采集/ASR空闲，未卸载或清资料 |
| 真机提示恢复 | 三轮真实系统锁状态确认后正常解锁；同PID65516下原生日志均retry1/delay1000→recovered1，普通页显示前台同步；各轮settled布局和最终布局旧Service提示均为0，非健康冷启替代 |
| 操作反馈交错 | 草稿/导入/保存反馈与恢复交错只有本机页面事件证据，独立原生交错场景仍待测；不由旧提示撤销推断全部消息互斥无误 |
| 新消息/端到端 | 未验证新的资料消息、断网恢复、Agent接收或任务完成；旧回执或提示清空不能推出这些结果 |

日志：[旧基线12项](../../rebuild/phase1/material-sync-panel-service-note-red-2026-10-14.log)、[修复12项](../../rebuild/phase1/material-sync-panel-service-note-green-2026-10-14.log)、[相关25项](../../rebuild/phase1/material-sync-panel-service-note-related-2026-10-14.log)。源码实际读回：Panel SHA256 `0c987a1d7d4028c7bc82d76db1c8ccccce650e55e7233dbe2a00840207819d4b`；新增测试 `c50b7cf81fd66bf8219b939faff489244118f705c71732f2cb65972eaaa29fd1`；未改Service `7b7ea77bdc6d7690721617d0ce2db28066f4cf028e7d70155b04036ff2b4be98`。不追认成旧805冻结包的结果。

## 产物与原生证据

真实构建run `20261014-074852364-13d6d22d`，source manifest SHA256 `fb0d6656f620bdcb25d5b891db4191422bbb5b1dc92a597e223b661f8c63c7d9`；实际build/sign日志与状态一致。最终签名HAP448527564 bytes，SHA256 `ad6fde62bdaf3637197b304c7a54156fc2cbfe92cbf9ae7ae7745c744006b1b7`，设备实际版本另行读回核对。

三轮原生重试/恢复时刻（北京时间）：07:55:20.137→07:55:21.190、07:55:37.610→07:55:38.669、07:55:55.685→07:55:56.753。每轮真实系统锁状态、同进程原生hilog及普通窗口布局对应；未重新保存设置，驱动没有写凭据或资料。无保存及无写入结论来自操作ledger，不扩为完整输入事件日志；键盘、密码或凭据原始信息不公开。

公开报告：[material-reload062-native-device-2026-10-14.json](../../rebuild/phase1/material-reload062-native-device-2026-10-14.json)；复核脚本：[summarize-material-reload062-device.mjs](../../tools/phase1/summarize-material-reload062-device.mjs)。报告脚本的版本名复制残留已修正，按实际0.1.62/10062断言；每轮settled布局直接断言旧提示不存在，不只依赖操作ledger的布尔标记。独立审阅后已用项目Node22重放通过，核对6份冻结源码/测试、manifest/HAP、安装版本、锁状态、6行同PID元数据及正常页反馈。脚本不联网或操作设备，仅从既有证据生成白名单元数据。

保护资料实际读回：第10版canonical SHA256 `83248d4c6b50ed750875be3fb52b5907cc0e5d823aaed9d5b5e8d1687bfed6a5`、原音 `cd2ba1e3a85dfb445fed45ec8bf5c0d29acd261a579349c9bcedc5462e0477e1`、原ASR `97c7ae1b6e397343cca293a833598a0011edce2751fb7f9f91f17e1169679cc1`，与此前公开哈希一致；整个outbox与0.1.60冷启后账本逐字节一致。当前累计32个已存版本、0待同步/0需处理，不代表本批新上传32份，也不证明没有网络重试包或所有手机文件均不变。

## 开放边界与下一出口

本批仅关闭“Service自动恢复后撤销其旧提示”的正常页子场景。若仍出现Panel自身的读取/导入/保存失败，不因Service健康而强制清除，保留实际问题供用户处理；操作反馈与恢复交错的独立原生验收仍开放。

本批不改变原材料、历史修订、墓碑或回执；既有保护样本在设备验证中继续核对。保存跨dispose/reinitialize的原生竞态、新消息在暂不可读恢复后的公网出口、正式配置断网/积压恢复、自动轮换、8小时/功耗、原音归档/回放仍是独立开放项。

后续按[当前入口](./DEVELOPMENT-STATUS.md)推进每日总结的修订绑定、最新导出/汇总、RecordingPanel独立真机删除及P23/P25基础差距。官方BASE完整对齐要求、P13评审和分层验收保持；不改旧0.1.61历史记录，Excel仅在用户明确要求时更新。
