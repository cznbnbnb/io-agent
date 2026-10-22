# 官方校时 UTC 字段类型定点核对

2026-10-13。对应 PRD BASE-02 的设备设置基础线。仅核对既有参考库、现有源码和根 agent 提供的脱敏设备事实；本审计未操作手机、眼镜、云端或模型。

## 当前失败与修订范围

`device-clock-baseline-2026-10-13.json` 记录手机系统时区 `Asia/Shanghai`、手机 11:31、用户观察镜片 03:31。实际发送 business15/type5 的 `sync_time`，data 字符串内部为 `{utc:1791862005,offset:28800,timezone:"Asia/Shanghai"}`，其中 utc 为 JSON number。对应 type6 没有返回时间值，本次无 analytics。该事实已排除“仅改掉旧 Chicago 名称就修好”的结论。

候选只把正式 `syncTimeCommand` 的 UTC 秒从 JSON number 改成十进制 JSON string。数字入参、整数范围、当前 UTC 时刻、数字 offset 秒、IANA 字符串、字符串 data、business15/type5、value0/mode0 全部保持。没有给 UTC 加八小时；没有改毫秒、偏移单位、探测入口、SDK 时区读取或固件。

## 原始素材与函数定位

既有素材为 `reverse/libapp/libapp.so`，40,371,120 bytes，SHA256：

`eba61c2b6c161b05da0c68018d81240257eb4986037f746f8646f40f641be6dc`

blutter 输出的 `native_runtime_bridge.dart` 只保留 closure `0x1806ff8` 的入口，未给方法正文。使用已安装的 PyELFtools 映射 ELF 虚拟地址至文件段，Capstone 只读解码实际字节，找到 `0x18071fc -> 0x1807228 -> 0x24e5878`。最后一个地址才是校时主体，至 `0x24e5b80` 前结束。

独立 JSON 记录字段构造、函数地址、哈希和交叉引用；`.asm.txt` 只保存六段相关指令，没有复制或提交第三方库。

## 构造证据

| 字段或动作 | 实际指令与对象池证据 | 结论 |
| --- | --- | --- |
| UTC 单位 | `0x24e58b4` 调 `_getCurrentMicros`；`0x24e58f4`、`0x24e58f8` 连续除 1000 | 秒 |
| UTC 类型 | `0x24e5964` 放 key `PP+0xce90 = utc`；`0x24e59ac` 调 `GDT[cid+0x8d28]`；`0x24e59b8` 把该结果放入 Map | 十进制字符串 |
| offset 来源和单位 | `0x126ddb4` 调已命名的 `_timeZoneOffsetInSecondsForClampedSeconds`；`0x14b87e0` 把秒乘 1,000,000 构造 Duration；`0x24e5914` 再除 1,000,000 | 秒，未改成分钟或毫秒 |
| offset 类型 | `0x24e59e0` 放 key `PP+0xce98 = offset`；`0x24e5a10` 直接放整数对象，没有调用 toString | JSON 整数 |
| timezone | `0x24e5a34` 放 key `PP+0xcc80 = timezone`，随后放已解析字符串 | 保持字符串 |
| data | `0x24e5af4` 编码上述 Map，`0x24e5b04` 放入 Payload.data | JSON 字符串 |
| 信封 | `0x24e5b24` 加载 `PP+0xcec0 = singleSettingChangeToGlass = 5`；`0x24e5b38` 加载 `PP+0xcec8 = sync_time`，显式传 type | type5，不是 callee 的默认 type2 |

`GDT[cid+0x8d28]` 的 toString 绑定由同一 APK 的三个交叉引用确认：

- `in_app_purchase_android/src/messages.g.dart:247`：把任意捕获错误转换后放入 `PlatformException.message`，对应 `0x24f1610 -> 0x24f1638`。
- `summary_setting_models_provider.dart:91`：把 `int?` 用户 ID 转换为 API 字符串参数，对应 `0x25a5ae0`。
- `dev_mp3_import_session_page.dart:84`：把任意捕获 Object 转换为用户提示 message，对应 `0x245da78`。

这些证据说明 UTC 处的动态调用不是数字原样存储，也不是对 UTC 加时区偏移。

## 实现入口与验证边界

真实编译入口和组件测试都使用 `rebuild/harmony-sdk/turbo_core/src/main/ets/BusinessCommands.ts`，`tests/load-core.mjs:15` 直接加载该目录。`core-probe` 没有另一份 `BusinessCommands` 或 `syncTimeCommand` 源码，本批没有盲目复制。

协议、DeviceFeatures 零偏差发送及现有连接回归共 47/47 通过，日志 `clock-utc-string-regression-2026-10-13.log`。新增检查解码实际信封，保证 UTC 是同一 epoch 秒的字符串、offset 仍为数字秒、错误单位和非整数入参仍被拒绝。

**尚未认定镜片修复。** 根 agent 负责 0.1.53 构建、覆盖安装、实际发送 metadata 和用户镜片观察。安全验证只重发当前时刻：`{"utc":"<当前Unix秒>","offset":28800,"timezone":"Asia/Shanghai"}`，不运行 +小时或毫秒探测。空 type6 回显和 analytics 埋点时间均不能代替实际镜片本地时间确认。
