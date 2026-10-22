# 提词器 SmallCore 文件通道修复及正常页控制回归

日期：2026-10-14。关联P20/P25、BASE-08；基线为`12a450e`及实际安装0.1.64候选2。本批0.1.65/10065已覆盖安装，关闭本次传稿通道错误及以下协议/手机单项，**不关闭BASE-08整体**。用户外出，镜片观察统一留在[人工验收H01](./USER-VERIFICATION-TODO.md)。

## 原因与最小修改

0.1.64取得准备允许，却在传稿0%停止。[失败记录](./phase2-teleprompter-editor-2026-10-14.md)保留，不追认为成功。对照本地提取的原厂Android资料，发现真实`rayneonet_sendFile`调用选择`RNShareTarget.SmallCore`；`RNTransferSender`据此使用`BusinessID.FILE_TRANSFER`，外层business及FileInfo.busId均为**17**。18对应另一个`FILE_TRANSFER_LAUNCHER`通道。`WhenMappings`中的18是分支索引，不能当作线上的业务值。

参考源码位置：

- `RayneoNetPluginBridge.java:1952`：发送目标SmallCore。
- `RNTransferSender.java:118–123、322–325`：目标对应业务、FileInfo.busId与发送通道。
- `BusinessID.java:42、49`：实际17/18。
- `TransferMessagePB.java`：核对FileInfo及六种外层oneof的字段号。

本地提取manifest为**1.0.0/52**；不沿用此前将另一份研究资料称为1.0.4的说法，也不据此推断当前商店版本。[参考路径、原APK与源码摘要](../../rebuild/phase1/prompter065-official-reference-2026-10-14.json)可以复核。只是检查现有协议资料，没有把原厂SDK代码链接或复制进App。

本批只修改提词文件流及其传输依赖：

1. FileTransfer支持17/18，默认18保留；提词明确选择17，FileInfo.busId与外层一致。
2. 认证后仅protobuf文件17/18允许有界跨ATT写入；仅下发信息/块/取消类型，信息通道不一致拒绝。其他业务仍保持MTU及原白名单限制。
3. ProbeSession转交17；TeleprompterSession只接17/20，本轮UUID、peer、状态及完整文件/业务双就绪守卫保留，外国18完成包不能解锁开始。
4. 增加有界元数据观察：文件类型、UUID是否匹配、字节数、请求范围、完成状态及安全错误分类。只发布本轮随机did，不记录稿件正文、任意外来UUID或原始包。

business20控制ACK仍要求匹配did/action/type及code1；**没有放宽退出code2/3**。这两个值在失败场景的含义仍未确认。稿件编辑状态、保存、录音、智记、云端、模型和固件没有重写。

## 构建与回归

四组相关源码回归57/57，其中包含官方protobuf字段号的固定十六进制样例、17实际分段发送、信息内外通道不一致拒绝、旧18保持、外来18完成包不能推进提词。它们使用明确的平台替身，属于宿主代码回归。最终完整App **853/853**通过，不是镜片或产品验收数量。

- 版本：**0.1.65/10065**；真实DevEco CLI编译88.881秒、签名63.382秒，依赖成功、未用缓存兜底。
- 构建run：`20261014-134744295-6a609a30`；源码清单摘要：`e62a7d08f705d892410add0041847ca1a37fc4f4485b6820df39d0727115cded`。
- 签名HAP：[entry-default-signed-0.1.65.hap](../../rebuild/phase1/artifacts/entry-default-signed-0.1.65.hap)，448553105字节，SHA-256 `ba5ca08b92fec0b90b6dbd03ea404de25942aac8bd5936aadf3f8d99c0014bdf`。
- [构建冻结记录](../../rebuild/phase1/prompter065-build-2026-10-14.json)为安装前事实，`native_verified:false`不改历史含义；安装及测试事实分别见[真机报告](../../rebuild/phase1/prompter065-native-device-2026-10-14.json)。签名后源码/暂存核对通过，生成真机报告时再次核对全部源码清单和HAP。

覆盖安装前确认录音、智记和ASR空闲，未卸载、未清资料。实际PID `62751→17358`，系统读回10065。安装前后及三轮协议结束后，原音、原ASR、已有第10版canonical与整个outbox账本四个文件摘要分别一致。

## 真机协议及手机出口

使用普通提词页、原生控件和当前布局/焦点检查。先选回已有数字测试稿，标题`20261014064`、正文11字节；后两轮使用1931字节数字草稿，不调用保存，不新采音、不转写、不创建待办或执行Agent任务。

| 单项 | 实际证据 | 结论边界 |
| --- | --- | --- |
| 11字节短稿 | business17信息→匹配文件ACK→请求0/11→块提交→匹配完成state0；business20准备code7，ready/100% | 文件与业务联合就绪通过；只收到准备code1不足以通过 |
| 短稿开始/退出 | 13:56:49开始type3/action2/code1，进入running；13:57:27退出type6/action2/code1，回idle | 真正的设备控制确认；不是函数调用名或提交成功 |
| 1931字节长稿 | 14:26与14:29两轮独立did均取得文件完成、code7及ready/100% | 此大小传稿通过；48KB上限、多块重试及Unicode镜片效果仍待测 |
| 继续 | 两轮匹配type5/action2/code1且running；普通页暂停按钮启用 | 继续协议/手机反馈通过；实际镜片位置与滚动留人工验收 |
| 手机主动暂停→再次继续 | 14:29:55手机type4/action1→眼镜action2/code1→paused，手机“继续”启用；14:29:59再次type5确认→running | 与眼镜主动暂停分开取证，此手机控制链通过 |
| 调速120→180 | 14:27:14手机type7→匹配action2/code1，随后Session.running/speed180 | 确认速度状态通过；肉眼速度是否变化待H01 |
| 活动切页 | 长稿运行时切天气再返回，正文1931字节保持、编辑禁用；同did未重传、未退出 | 手机活动/草稿保持通过；镜片无闪退/重发待H01 |
| 清理 | 三轮退出均匹配code1；最后14:33:19回idle、传稿按钮重新启用 | 本轮均已结束；App退后台自动退出尚未真机验证 |

短稿开始约0.5秒、长稿开始约0.7秒后，眼镜主动上报type8及type4/action1/code1。长稿偏移为1715B，随后继续可被确认。**原因未查明**，不能断言是未佩戴、走到末页或排版故障，也不能把开始后自动暂停包装成完整滚动成功。短稿脚本的`running:false`表示等待手机稳定running未赶上该瞬态，不抹掉真实开始ACK，也不把它当完整开始体验通过。

自动化失败保留：原生inputText先把新文字追加到旧11字节草稿，精确校验停止下发；之后明确使用这份已核对的1931字节合成草稿。首次中央滑动被TextArea消耗，未找到按钮、没有下发；改为当前可见外层Scroll的非输入边缘后继续。最后控制补测在手机主动暂停/继续完成后遇系统通知遮挡App标志，脚本停止输入；通知消失后重新核对所属窗口，再退出原did。没有盲点通知或绕过焦点守卫。原始布局、失败、日志和脚本在忽略的`device-private/prompter065*`中。

## 下一步与复核

H01现在可集中做镜片观察：长中文稿的内容/排版、实际滚动、自动暂停现象、暂停/继续位置、速度变化、活动切页和退出是否清除。用户回家前不反复催问。自动化可继续补App后台退出、文件导入/稿件管理及其他BASE差距；Unicode传输与48KB边界单列，不由数字稿外推。

P23真实双人、P24总结竞态与导出目标独立读回、P43正常手机闭环和后续阶段按原依赖推进；本批不重定排序，不用提词单项通过代替官方基础完整对齐。Excel没有更新。

复核已有留存证据（不操作手机）：

```powershell
& 'C:\Users\LENOVO\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'tools/phase1/summarize-prompter065-device.mjs'
```

该工具核对HAP、源码清单、安装PID/版本及保护文件，只输出合成测试标记和协议元数据；读取私有证据后重建公开报告。全App回归命令继续在`rebuild/harmony-sdk`执行`D:\openclaw\nodejs\node.exe --test --test-concurrency=2 'tests/*.test.mjs'`，需要时才重跑，不将重复数量折算进度。
