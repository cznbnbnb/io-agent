# Turbo IO 鸿蒙 APP · 设备功能计划 v2（证据驱动）

> **当前实施顺序**：执行 [开发顺序与阶段验收](../../../docs/product/DEVELOPMENT-PLAN.md) 的阶段 0–7 与 P 系列任务。本文下方的历史阶段编号不再用于排期；尤其应先实现电脑常驻连接与会话恢复，再接正式眼镜决策流程。

> **2026-10-10 产品计划更正**：本文件保留 9 月协议研究与历史实施记录；当前需求、优先级与发布门槛统一以 [独立 App PRD v0.2](../../../docs/product/PRD.md) 为准。原“智记服务器上传 P2/后续开发”“非核心基础功能后置”的安排已被新需求替代：官方基础体验必须对齐，服务器承担资料存储与消息中转，本地 Agent 负责分析执行，并通过眼镜选择/语音收集用户决策。已完成录音和可用硬件接口复用；充电不再作为白天智记产出文字的必要条件。以下历史协议线索仍按各自证据状态使用，不视为当前完整产品验收结论。

> **v2.2 修订（2026-09-30 晚，真机日志复盘后）**：
> 1. **blutter 定论**：拉出完整 `GlassesMessageCmd`（43 项）与 `GlassesMessageType` 枚举表 —— 设置写入 = business 15 / 信封 **t5**（singleSettingChangeToGlass），命令串 `privacy_config`/`wakeup_config`/`crown_config`/`display_config`/`head_gestures`/`auto_lock_time`；`focus_mode`/`brightness_change` 走 **t2**。子字段 jsonEncode 进 `payload.data`。
> 2. **真机日志证实写入生效**（launcher-rx.jsonl 18:06 会话）：`wakeup_config` 写 40°→ 眼镜回 t6 回显 + t4 推送 headupDegree=40；18:18 写 30→20 同样生效；`display_config` height 1→2 生效；`brightness_change` 8/7 生效（t1 读数跟着变）。**"按钮没反应"实为 UI bug**：`refresh()` 用旧缓存 settingsJson 无条件覆盖 @State，把乐观更新打回去（抽搐恢复）。已修：rev 版本号门控，只有内容真变化才重解析。
> 3. **payload 占位符与眼镜序列化对齐**：未用字段用 `mode:0`/`data:""`（t6 回显实证），不用 null；`led_light`/`display height` 钳制下限放宽（眼镜现值就是 1，不能顺手改掉）。
> 4. **写回执可见化**：每条写入 1.5s 后自动读回（t4+t1），状态行给出「读回确认已生效 / 读回未见变化 / 读回超时」三态判定；判定依据 = 对应域内容变化或同 cmd 的 t6/t3 回显。
> 5. **时间同步仍未生效**（+1h 探测：眼镜时钟没跳）。已发现 ArkTS `Intl` 报错时区（America/Chicago 配 +8h 偏移）→ 加墙钟交叉校验+偏移回退。剩余未知：utc 单位（秒/毫秒）、信封 t5/t2、data vs value 字段。已加「时间格式探测」按钮（A +1h t5/秒、B +2h t5/毫秒、C +3h t2、D +4h t2/value），用眼镜自身时钟轨迹一次性判定。
> 6. **debug-conn.log 刷屏**：状态回读每秒重复发布 ready → publish 去重。
>
> 📌 **详细交接快照（进展 / 待办 / 踩雷 / 命令 / 证据位置）见 [`HANDOVER-2026-09-30.md`](./HANDOVER-2026-09-30.md)**。

> **v2.1 修订（2026-09-30 下午真机探测后）**：
> 1. **历史炸弹已修**：`launcherCommand` 模板少一个 `}`，全部通用命令 JSON 非法（sync_time/亮度/休眠/语音唤醒的"回执成功"实际未被执行）。已修复 + 加了 JSON 合法性回归测试。
> 2. **探测定论**（合法 JSON 后重测）：通用命令仅 `focus_mode`（部分生效）、`auto_lock_time`（有回执无实效）、`sync_time`（有回执）有响应；`brightness_change`/`mic_switch`/`headup_switch`（t2/t5/t17 均试）无任何响应。设备设置写入确认走「单项设置消息」私有格式（`settingType`/`settingValue` + 三族枚举），枚举数值与信封格式字符串层拿不到 → 上 blutter。
> 3. **路由发现**：眼镜对读请求的应答按信封 type 路由（type 1=状态 / 4=设置），body 不参与解析（非法 JSON 也照答）。
> 4. **ACK 补齐上线后真机无回归**；needAck 帧正常分发+应答。
> 5. 探测节奏教训：批量轰击会让眼镜通信懵 4 分钟（可自愈），单项探测+读回才是正确节奏。
> 6. focus_mode 副作用：`enableGlassClose` 被改 0，还原已发出待确认。

调研日期：2026-09-30。四路调研：jadx 原生代码（A 级证据）、Dart 快照字符串（B 级）、开源社区+鸿蒙官方文档、云端抓包盘点。
原始报告：`reverse/dart-schema-report.md`（Dart schema）、`tools/libapp_strings.jsonl`（27.6 万条字符串索引）、`tools/dart_strings.py`（可复用提取器）。

## 一、对 Plan v1 的纠错（调研推翻了什么）

1. **通知通道是 21 (0x15)，不是 0x11**。0x11=17 是文件传输。官方日志里的 `0x22` 也不是通道号，是 `AssistantMsg.type=34 (phone_vqa)`。
2. **语音助手"请链接到手机app"不是缺注册握手**。眼镜双击旋钮后在 VOICE_ASSISTANT(13) 通道发 `type=1 wake`，等手机应答；无人应答才提示。实现 responder 即可解决，不需要逆向什么绑定流程。
3. **全天智记不是私有通道瞎摸**。VOICE_ASSISTANT(13) 上有完整 A1–A5 子协议（见下），taskId 语义、逐帧 VAD 掩码、断档补拉全部已知。
4. **我们的传输层帧格式已与官方逐字节一致**（核对 `turbo_core/.../ProtocolCodec.ts` vs `ProtocolBuilder.java`）：0xAA55 头、大端长度、messageNumber、packetType、businessId、payload、CRC16-XMODEM。**但有一个缺口**：官方响应帧头是 0x55AA，我们的 `declaredSize()` 只认 0xAA55，且未实现"收到 needAck 帧自动回 ACK"——需要核对补齐（可能是若干诡异 bug 的根因）。
5. **通知监听在鸿蒙有官方正路**：`NotificationSubscriberExtensionAbility`（API 22+，鸿蒙 7 可用）+ `ohos.permission.SUBSCRIBE_NOTIFICATION`（ACL 受限权限，但 debug 自动签名可直接拿）。不是之前以为的"封死了"。
6. **小艺接入对个人开发者走不通**：Intents Kit 仅面向企业开发者。用自研语音助手链路平替。
7. **抓包里没有任何雷鸟云端流量**（Flutter 不走系统代理）。云端 API 清单只能从 libapp.so 字符串恢复，结论：除天气/LLM/OTA 外全部可本地化。

## 二、官方协议事实表（A 级证据，jadx 代码直出）

### 帧格式（com.ffalconxr.mercury.coreconnect，SDK 2.0.74）
`AA55 | len(2,BE) | msgNum(2) | packetType(1: bit0=needAck, bit1=hasAddr, bit5-7=sliceLen) | addr? | businessId(1) | payload | CRC16-XMODEM(2, 覆盖 msgNum..payload)`
MTU 512（写上限 509B/包），流式重组无应用层分片号；响应帧头 0x55AA + 同 msgNum + 同 businessId。
写特征 `ea8b70d5-…`，notify `7db3e235-…`，扫描过滤 service `0000b81d-…`。

### BusinessID 全表（官方枚举 BusinessID.java）
0 保留 / 1 应用市场 / 2 快捷指令 / 3 陀螺仪校准 / 4 轻语模式 / 5 屏幕锁定时间 / 6 版本校验 / 7 ActionButton / 8-10 火星系列 / 11 日志报障 / 12 心跳 / **13 语音助手** / **14 录音业务** / **15 Launcher** / 16 连接配对 / 17 文件传输 / 18 文件传输(大核) / 19 AI字幕 / 20 提词器 / **21 通知** / **22 日程待办** / 23 PROACTIVE_AI / 24 AI_WIDGET

### 语音助手（businessId 13，protobuf 信封 `AssistantMsg{version,type,message:JSON,data:bytes}`）
- 眼镜→手机：1 wake(`{rc:wakeType,mode,linkType}`) / 3 Opus 音频流(16kHz) / 8 exit / 11 next_round / 48 offline_tts / 51 reminder / 54 glass_state
- 手机→眼镜：**2 recorder_control** / 4 vad_status / **5 asr_text{text,isFinal}** / 6 tts_state / **7 exit{rc,errorMsg}** / 9 state_event / **10 deep_thinking** / **12 response_complete** / 16 common_settings / 32 skill_payload / 34 vqa / 53 phone_state
- 无独立注册握手：应答 wake 即建立会话。TTS 音频不下发眼镜（手机本地播或眼镜离线 TTS）。

### 全天智记 AlwaysOn（businessId 13 上的 A1–A5 子协议）
- 眼镜 `161(A1) always_on_wake` → 手机回 **`162(A2) {taskId, idleTimeoutSec}`（官方默认 300s）**
- 眼镜 `163(A3) realtime_audio {taskId, vpuMask, vadMask, mode, frameCount}` + data=**N×240B Opus 帧**（16kHz，vpuMask/vadMask 按位对应每帧 = 免费逐帧 VAD）
- `164(A4) cached_audio{taskId,isFinish}`、`165(A5) exit{taskId,isFinish,rc}`
- 手机可主动发 **`167 query_cached_audio` 拉断档缓存**、166 abnormal_exit、168 页面状态
- 录音业务共享音频走 businessId 14，`type=3` Opus 上行
- 官方转写/总结在云端（`/transcription/*` + OSS），我们已本地化，不受影响

### 设置读写机制（Dart 侧，B 级）
- 读：`request_general_settings`（类型码 0x04）/ `request_general_status`（0x01），响应 JSON；键集已全量验证（含 headup_switch/headup_degree/crown_config/dnd_mode/mic_switch/led_light/display_height/display_distance/screen_status/hall_folded/auto_sleep 等），变化通知 `general_settings_changed`
- 写：**单项设置消息**（`sendSyncSingleSetting`，无逐键 snake 命令），type=三族枚举：
  - DeviceInteractionSettingsSettingType(9)：AutoSleep/HeadControlDirection/HeadControlEnable/KnobControlDirection/KnobWake/LiftWake/LiftWakeAngle/ShortcutDoubleClick/ShortcutLongPress
  - DisplaySettingsAdjustSettingType(3)：Brightness/DisplayDistance4/DisplayHeight
  - PrivacySettingsSettingType(4)：IndicatorAutoBrightness/IndicatorBrightness/MicrophonePermission/ShareAnalytics
  - 布尔值 `SettingValueOffOn{off,on}`；全量 `SyncAllSettingsMsg`；ack 后 `.afterSettingsAck`
- AI 模型枚举（确定）：CHATGPT_5_1 / CLAUDE_OPUS_4_1 / CLAUDE_SONNET_4_5 / DEEPSEEK_V3 / GEMINI_2_5_FLASH / GEMINI_2_5_PRO / ADVANCED_MODEL / RAYNEO_AI

### 待办（businessId 22，B 级）
消息类型全：syncTodo/batchSyncTodo/todoStatusUpdate/batchStatusUpdate/syncSchedule/batchSyncSchedule/scheduleStatusUpdate/deleteEvent/appQueryGlasses/appQueryResponse（含 scheduleTotal+todoTotal、chunks 分片、needFullData 全量查询）

### 通知（businessId 21，B 级）
消息流：forwardRecvNotification/setNotificationEnabled/callStateChanged/ancsNotification/glassesNotificationReply/0x11 全量同步；锚点 `NotificationEvent(packageName:…)`、`NotificationAppSetting(iconUrl:…)`、`AppListData(bundleId:…)`；云端 `queryAppList` 只是推荐清单+图标，可完全本地化（鸿蒙 bundleManager 枚举）

## 三、阶段计划（按用户痛点 × 证据完备度排序）

### 阶段 0 · 零风险打底（立即）
1. **ACK 语义补齐**：核对眼镜发来的 needAck 帧我们是否回 0x55AA；补齐自动 ACK + 接受 0x55AA 入帧（ProtocolCodec/ProbeSession）。疑似多处诡异 bug 根因。
2. **general_settings 全量落盘**：真机读一次存 `filesDir/last-general-settings.json`，拉到电脑核对键值——dnd/息屏/轻语映射随之明确，写路径候选收窄。
3. **sync_time 实测**：连接进 ready 后发送（候选 payload：`{utc_time}` 秒级 ± timezone/utcOffset），读眼镜状态栏时间验证；失败换毫秒/带时区。

### 阶段 1 · P0 痛点（用户点名）
4. **语音助手 responder**：监听 type=1 → 回 type=2 开始收 type=3 Opus → 本地 ASR（已有 sensevoice 链路）→ type=5 上屏 → 可配置 LLM API 生成回答 → type=10/12 下发（眼镜屏显示对话）。顺带解决"AI 连不上"与"小艺平替"。
5. **设备设置页读写**：单项设置消息实现三族枚举（抬头唤醒+角度、旋钮方向/唤醒、头部控制、自动休眠、显示高度/距离/亮度、指示灯、麦克风权限）。每个写入先过读-写-读回环验证。
6. **待办双向同步**：appQueryGlasses(needFullData) 全量拉取 + syncTodo 分片下发 + 状态回传；UI 分「待完成/已完成」。

### 阶段 2 · P1 增强
7. **全天智记对齐 A1–A5**：taskId 会话语义、vadMask 辅助本地 VAD、**167 缓存补拉**（手机断连期间的录音不丢——这是"全天"的关键）。
8. **通知转发**：NotificationSubscriberExtensionAbility + SUBSCRIBE_NOTIFICATION（debug 自动签名 ACL）→ 通道 21 下发；应用白名单本地枚举 + 内置默认清单，零云端。
9. DND/息屏互动/轻语模式（等阶段 0 落盘结果定映射）；天气按位置+时间刷新策略。

### 阶段 3 · P2 后置
10. OTA：固件来源仍拴雷鸟；只做"用户手动取包→本地 FILE_TRANSFER 推送"，不自动升级。
11. 智记自动上传用户服务器（本地钩子，用户后续开发）。
12. 小艺/Intents Kit（企业主体门槛，个人开发者无法申请，后置或放弃）；翻译（时空壶凭证雷鸟管控，不可复用）。

## 四、验证方法论（"不猜"的落实）

- **证据分级**：A 级（jadx 代码）直接采用；B 级（Dart 字符串锚点）必须过**真机读-写-读回环**（request_general_settings → 写候选 → 再读确认值变化）才进代码白名单；C 级（纯推测）不进主干。
- **精度兜底**：B 级字段不够时上 WSL2+blutter 恢复字段号/枚举数值（一次性环境投入，按需，不阻塞主线）。
- **写入红线**：不碰 factory_reset；不碰 OTA 固件写入；不碰保留/未知通道；不解绑眼镜；新写入一律先在可逆设置（亮度、显示高度）上验证。
- **构建-验证链**：改动 → 单测（277 项，Node 22）→ hvigor 编译 → 模拟器+uitest 截图自验 → 真机安装（hdc -t 6HQ0226407055391）→ 同名 HAP 覆盖到 rayneo_glasses。不发飞书。

## 五、悬置问题

- DevEco Studio 26 安装包已在 Downloads，是否安装 + targetSdk 提 26（等用户点头）。
- "息屏互动"的确切协议映射（候选：轻语模式 businessId 4 / screen_status / wakeup_config，待阶段 0 落盘数据）。
- DND 写入路径（不在三族枚举内；可能眼镜侧自治或走其他命令，待落盘后探测）。
- 心跳 businessId 12：官方 Java 侧无发送方，疑 Dart 周期发送或已弃用；我们目前无心跳也能稳连，观察即可。
