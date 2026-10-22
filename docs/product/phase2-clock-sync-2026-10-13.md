# BASE-02/P25：眼镜校时字段类型修复

日期：2026-10-13；基线 `1748143`，已安装0.1.52/10052；候选0.1.53/10053。用户报告基础缺陷，按[执行流程](./DEVELOPMENT-PLAN.md)优先于下一批资料增强，独立于刚完成的删除修复。

## 实际观察

用户同时看到眼镜 **03:31**、手机 **11:31**。手机HDC只读 `date` 为2026-10-13 11:31 CST，`persist.time.timezone` 为Asia/Shanghai。这个8小时差是观察事实，不直接推断毫秒单位或擅自把UTC加8小时。

已有校时代码及首次ready/重连共用调用。0.1.52实际协议日志中的business15/type5 `sync_time` 为：

```json
{"utc":1791862005,"offset":28800,"timezone":"Asia/Shanghai"}
```

上面是 `payload.data` 解码后的内容，外层value/mode均0，data本身为JSON字符串。当前时区和偏移已经正确组合，不能仅替换Intl后声称修复。接收type6的空sync_time回显不是实际时钟确认；此次没有取得analytics读时钟证据。公开元数据见 `rebuild/phase1/device-clock-baseline-2026-10-13.json`；完整原始日志留在忽略的private目录。

## 原厂函数证据与最小修改

旧pp字符串和不完整函数摘录不足以确定时间单位。对已保留的原厂APK `reverse/libapp/libapp.so` 定点只读分析，SHA256为 `eba61c2b6c161b05da0c68018d81240257eb4986037f746f8646f40f641be6dc`。

实际校时函数0x24e5878：当前微秒连续除1000两次形成UTC秒；offset为数字偏移秒；UTC值在进入Map之前调用GDT toString，offset直接存boxed整数；data进行jsonEncode，发送显式type5/sync_time。toString槽经同APK中Pigeon错误message和整数用户ID字符串参数等交叉引用核对。证据与必要小范围指令摘录：[研究说明](../../rebuild/phase1/clock-official-aot-audit-2026-10-13.md)、[字段/哈希证据](../../rebuild/phase1/clock-official-aot-audit-2026-10-13.json)、`.asm.txt`。没有复制整个第三方库。

修复只改 `turbo_core/BusinessCommands.syncTimeCommand`：保持number整数秒输入校验，编码为十进制JSON字符串。UTC数值、数字offset秒、时区、business15/type5、外层data字符串全部保持：

```json
{"utc":"1791862005","offset":28800,"timezone":"Asia/Shanghai"}
```

独立只读审查未发现明显正确性风险。没有更改SDK时区策略、固件或用户手机时钟；没有运行会拨快数小时的格式探测。`syncTimeProbeCommand`/旧探测按钮保持实验边界，不能用其旧数值路径作正式修复证据。

## 分层验证

| 层级 | 结果/边界 |
| --- | --- |
| 协议与调用组件 | 47项通过，检查正式UTC字符串/offset数字、整数输入与非法毫秒值拒绝、DeviceFeatures零偏差的实际信封及相关连接回归；`clock-utc-string-regression-2026-10-13.log` |
| 编译/签名/覆盖安装 | DevEco CLI实际编译及既有证书签名通过，4份核心/调用/版本源码与暂存一致；448151804 bytes，SHA256 `21d026892f158a6bbc66601247fda36c90ea33003074c5d00f5887e2625a64c1`；覆盖安装并核对0.1.53/10053，原数据/绑定保留，0.1.52签名基线另存。已有依赖警告不作为零警告 |
| 真机实际发送 | 当前TX type5 `utc:"1791863470"`、offset28800、Asia/Shanghai；相对手机UTC为取整误差-171ms，无8小时移位。对应RX type6仍是空回显，不当作应用确认。`device-clock-utc-string-2026-10-13.json` |
| 镜片实际时间 | 用户在0.1.53自动校时后确认“已与手机一致”。本次Shanghai时区、当前连接的8小时偏差修复取得镜片实测确认；用户未提供修复后的具体HH:mm，不补造读数 |

本次用户报告的8小时偏差已修复并获真机观察确认，代码提交为 `310be1f`。0.1.52完整App623项及删除冷启动7/13项属于此前版本；这次相关47项已包含相应核心/设备回归，不把历史全量或只读审查等同于新版本完整端到端。其他时区、夏令时切换、长期漂移及失败重试仍有独立验证边界，BASE-02整体仍未完成验收。
