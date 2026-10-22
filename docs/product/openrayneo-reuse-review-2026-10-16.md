# OpenRayneo 源码对照与本项目复用

用户提供的 [Tobi1chi/OpenRayneo](https://github.com/Tobi1chi/OpenRayneo)已按提交 `2449baaf8575f8579a80c0cdcc0fe6137ca82a8f`固定。只下载9个源码/文档文件，共113721字节，逐项核对Git blob及SHA256，[来源索引](../../rebuild/phase1/openrayneo-reference-2026-10-16.json)。没有运行它的程序、安装驱动、重配眼镜或变更鸿蒙连接；研究文件不是代理指令。

仓库采用Apache-2.0，协议与会话方法可参考；Swift/CoreBluetooth/Apple Speech/macOS驱动不能直接作为鸿蒙实现。实际产品仍由手机连接眼镜、服务器保存/中转、电脑Hermes经CLI与skill使用。对方README只记录一副眼镜和特定Mac测试，未记录固件版本；不能由其自述推定本机全部支持。若后续复制实现代码，须保留对应许可和来源声明。本批仅调整协议参数并注明来源。

| 场景 | 源码事实 | 与当前项目的差异及行动 |
| --- | --- | --- |
| 待办完整查询 | [DisplayController.swift:379](https://github.com/Tobi1chi/OpenRayneo/blob/2449baaf8575f8579a80c0cdcc0fe6137ca82a8f/Sources/OpenRayneoBridge/DisplayController.swift#L379)在business22/type15发`eventType:1`，收type16分批 | 当前类型已正确为15/16，但两个本机入口都发`eventType:2`；96实机多次0批/超时。97候选仅把两处待办筛选改为1，保留完整分批、原peer/lease、墓碑和不自动重放；需当前眼镜读回证据后才能称已修复。新增严格筛选的模拟同伴回归，旧代码126/128、修后128/128；不把模拟当硬件成功。 |
| 双通道有声 | [SpeechController.swift](https://github.com/Tobi1chi/OpenRayneo/blob/2449baaf8575f8579a80c0cdcc0fe6137ca82a8f/Sources/OpenRayneoBridge/SpeechController.swift)走business23提示页SID音频，分别解单声道识别与48kHz双声道保存 | 当前AgentReplyCapture走business13，是不同业务；不能直接把对方type4塞入旧type3解析。下一准备独立、显式授权、有期限和退出核对的23业务探测，复用现有Opus能力；先证明当前眼镜有声和双声道，再考虑接原任务。 |
| 长时文字/Agent上下文 | [显示协议](https://github.com/Tobi1chi/OpenRayneo/blob/2449baaf8575f8579a80c0cdcc0fe6137ca82a8f/docs/display-protocol.md)包含business19字幕及23提示页，两者都有SID和启动确认 | 可评估持久上下文页、完整答案预览和后续字幕；它没有证明business21建议卡能持续两分钟，也没有通用原生多选按钮。19/23均须独立实测，H07-T01继续开放。 |
| 文本网格/TUI | [布局记录](https://github.com/Tobi1chi/OpenRayneo/blob/2449baaf8575f8579a80c0cdcc0fe6137ca82a8f/docs/text-layout.md)基于字幕整帧文本与全角空白 | 可参考状态/任务提示排版；字符动画不是任意图形或系统UI。先验证静态文字和退出，不在当前批次加入视频播放器。 |
| skill与执行边界 | [.agents/skills/openrayneo-api](https://github.com/Tobi1chi/OpenRayneo/tree/2449baaf8575f8579a80c0cdcc0fe6137ca82a8f/.agents/skills/openrayneo-api)由skill调用常驻Bridge的HTTP接口 | 与本项目CLI+skill、独立连接程序/运行时适配器分工一致；仅安装skill不会获得蓝牙连接或恢复原任务。可借鉴命令/会话说明，不另起竞争蓝牙连接的Mac Bridge。 |

重要限制：23业务提示页启动本身会带来音频上行，`save_audio:false`不等于关麦；对方“text only”仍可丢弃收到的音频。不能据此在“用户点头才收音”的第一阶段无声开麦。本项目后续23探测必须位于明确授权之后，默认不保存原音、不生成真实待办、不执行Agent外部任务，并保留SID、期限、停止及设备退出证据。

对方待办增删采用type6全量读/合并/覆盖且仅记进程内所有权；本项目已真机及人工确认的type2单条新增、type7单条删除和持久意图继续保留，不引入覆盖未知待办的全量写。对方记录createTime毫秒/lastModifiedTime秒；先取得本机type16真实原值，再单独核对本项目的秒/毫秒归一，避免盲改已有用户时间。

97已完成真实DevEco构建、官方验签、同哈希覆盖安装与11项原资料保护。查询参数修正后type16在约194ms内到达，合成B元数据进入已同步态，但完整性累积器仍拒绝，完整查询尚未通过。没有抓取或公开原始待办正文，不能宣称已经证实本机缺少哪一字段。[真机分项证据](../../rebuild/phase1/device097-upgrade-query-2026-10-16.json)保留失败边界。

随后98仅兼容顶层分批字段、可选且一轮内固定的chunkInfo格式，并明确eventType1查询的待办计数范围；不降低根字段/总数/顺序/去重/同伴及连接轮次检查，不自动确认删除。4项新回归在旧实现全部失败，修正后132项相关检查通过；未重跑整套App，用实际DevEco与同哈希设备读回继续确认。此处132是宿主回归，不是132项产品验收。

98随后完成真实构建、官方验签、覆盖安装与11项原资料保持；[实际查询](../../rebuild/phase1/device098-upgrade-query-2026-10-16.json)约103ms返回，但仍判不完整。顶层分批兼容代码已落地，当前眼镜完整查询尚未修通，不能据对方设备格式继续盲改。下一先补有界的字段结构/拒绝原因观察，不保存待办标题、正文或ID值，不放宽未知字段和总数校验。收音与显示协议继续作为独立待测能力。

99诊断包随后通过134项相关检查、真实构建/验签、覆盖安装及11项原资料保护。[实际结构证据](../../rebuild/phase1/device099-query-shape-2026-10-16.json)显示可选chunkInfo为字面空对象`{}`；根分批和条目字段类型被解析器接受，累积器因缺少chunk四字段而拒绝。100仅把字面空对象归一为未提供chunk；非空部分chunk、根必需字段/顺序/总数、原peer/lease及墓碑继续严格。实际形状的两项回归在99上失败，修后136项相关检查通过，100正在原生构建，尚未装机或通过完整查询。99首份CLI重定向受Windows代码页影响中文前缀，结构证据只采用ASCII字段/类型摘要；后续实验明确启用Python UTF8模式，未据乱码转存用户正文。

**随后100真机收口通过：** 同哈希覆盖升级、11项原资料保持，CLI完整取得当前B的1批1条、85ms回包，A不复活/删除仍1次；冷启新进程/偏好字节保持及就绪后重查通过。[设备证明](../../rebuild/phase1/device100-upgrade-query-2026-10-16.json)。正常手机页实际按钮产生新query ID，完整结果与B可见，[页面证明](../../rebuild/phase1/device100-normal-page-2026-10-16.json)。未把单批实测扩展为多批/日程或完整BASE-06通过，也没有验证23有声、19持续文字或修复两分钟卡。当前保留100/99两物理签名包及一份源码stage，源码修正`4371ac3`；下一准备独立23 SID适配与CLI，先检查并复用现有Capture/Opus与清理规则。

未完成的准入/归档/schema12源码已由本线程按24个精确路径停放为Git stash `6b4f3b63f46247be318d0108cfb9148bfd48c9be`，原始文件摘要保留在忽略的device-private清单；本候选不包含它们，恢复时不得覆盖本轮查询修正。Excel不因本轮研究或设备验证自动更新。
