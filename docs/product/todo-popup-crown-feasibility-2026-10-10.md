# 原厂待办建议弹窗复用与旋钮选择可行性

日期：2026-10-10｜研究范围：本地官方 App 反编译资料、上游协议实现、固件研究符号表、当前鸿蒙消息路由。未操作眼镜、未发送测试卡、未改固件或 App 代码。

**2026-10-11真机补测更新**：上述日期描述的是最初研究。现已在原厂固件上用本App0.1.18下发type33，自定义标题/正文可见；用户确认旋转改变“添加/删除”的当前选择标志，短按提交当前选择，点头固定添加、摇头固定删除。实际收到同UID type34 cmd1/2，type35 code0已发送；动画未观察。原厂App自动触发的原卡未即时复现，任意多选、按钮文案及动画自定义仍未证实。详见[当前能力矩阵](./phase1-capabilities-2026-10-10.md)及[原始观察](./phase1-device-observations-2026-10-11.md)。以下保留当时研究与原实验范围，不以符号证据替代这次实测。

**2026-10-15停留时长补查**：0.1.82单张隔离CLI卡用户确认约5秒后不可见，退场画面未知；App在同UID等待约52秒后仍剩67827ms，120023ms才提交移除。两分钟连续镜片可读未通过，详见[本批证据与限制](./phase1-app-cli-2026-10-15.md)及H07-T01。已进一步反汇编缓存官方Android生成序列化函数0x1554a78–0x1554c60，核对七个键与下述子集一致，未见显示期限字段；timeRange不是倒计时证据。参考符号中的显示/息屏计时名称仍仅是线索，未从当前固件函数体证明5秒原因；不盲加未验证字段、循环重发或改用户锁屏设置。既有头势/旋钮人工结论保留，不重复测试。

**2026-10-15后续联合观察与原始参考固件核对**：前段为较早证据状态，保留不改。0.1.84单张卡下发后，用户直接确认“卡片消失，回到时间主界面”；同UID在手机仍待答、剩83885ms，前台/连接正常且操作数0。本轮未测精确秒数，不能把0.1.82“约5秒”的反馈移作本轮测量，[联合记录](../../rebuild/phase1/card-duration084-joint-2026-10-15.json)。离线另取得并核对一份原始参考Strix OS 1.0.4.12 AP，已由函数体确认建议卡初显固定5000/8000ms分支、非忙碌且焦点实际改变后固定重置5000ms，与普通通知`displayTime`/`focusTime`分开；详见下方第8节及[固定哈希证据](../../rebuild/phase1/card-duration-stock-2026-10-15.json)。当前眼镜固件未与该参考匹配；**H07-T01与用户要求的两分钟连续可读仍开放，未修复、未验收**。本轮用户断开手机回家，只推进离线研究/设计；不重复催镜片观察、不操作设备或Excel。

## 1. 最初研究结论（2026-10-10）

用户确认原厂存在“是否加入待办”弹窗，并可点头/摇头回复。这是可优先复用的交互入口。

**已有证据支持进一步验证原厂弹窗的旋钮选择能力，但尚不能确认旋转已被路由到该弹窗，更不能保证直接扩成任意多选项列表。** 值得先检查原固件是否已经具备所需行为，可能只需在鸿蒙端接入完整的建议卡协议。

分开判断三项能力：

| 能力 | 目前证据 | 判断 |
| --- | --- | --- |
| 下发自定义内容的待办建议卡并接收接受/拒绝 | 官方 App 模型与枚举、上游卡片编码和独立测试页相互印证；用户确认原厂弹窗存在 | 有明确实现依据，可优先验证本项目接入 |
| 在同一建议卡中用旋钮切换/确认两个动作 | 固件研究表存在建议视图选中高亮、服务选择动作及通知按键处理符号 | 有针对性线索，须检查调用关系或实测；不能仅凭函数名判定支持 |
| 动态下发 3–4 个任意选项及按钮文案 | 已读协议子集未见 options、selectedIndex、可变按钮列表，操作枚举只有两项 | 未证实；不能按已支持能力实现 PRD |

## 2. 正确的协议入口

这套交互属于通知业务 **business 21（十六进制 0x15）** 中的“建议卡”消息，而非普通文字通知，也不是业务 22 的待办列表同步。

| 方向 | 信封 type（十进制 / 十六进制） | 名称 | 含义 |
| --- | --- | --- | --- |
| 手机 → 眼镜 | 33 / 0x21 | recvSuggest | 下发/移除建议卡 |
| 眼镜 → 手机 | 34 / 0x22 | operateSuggest | 用户对建议卡的操作 |
| 手机 → 眼镜 | 35 / 0x23 | operateSuggestAck | 处理结果回执 |

注意：business 21 与信封 type 0x21 不是同一个编号层级；枚举的 ordinal/index 也不等于线上编码值。

官方 Android App 反编译对象中：OperateSuggestCmd.accept 的值为 1，delete 的值为 2。上游 iOS 协议实现把 2 映射为 reject。它们是建议操作语义，不能据此区分用户使用点头、摇头还是旋钮。也不能把 delete 自动解释成删除本地 Agent 任务。

回执枚举见 success=0、permission=1、network=2、otherFail=3。具体错误处理需按实际业务验证，成功回执不应冒充电脑任务已执行完成。

上游已实现的下发字段子集：suggestUID、suggestType、type、title、source、content，以及日程类的可选 timeRange。suggestType=2 为待办，1 为日程；JSON 内 type=1 表示新增，2 表示移除，和外层信封 type 分开。

可改标题/正文不代表“加入/忽略”等按钮文字也可修改。本次未发现按钮文案配置依据。

## 3. 旋钮相关证据应如何解释

本地 `focus/symbols.json` 中的相关函数：

- `rayneo::app::Notification::onNotificationKeyEvent`
- `rayneo::service::notification::NotificationService::selectSuggestAction`
- `rayneo::service::notification::NotificationService::operateCurrentSuggest`
- `rayneo::app::NotificationSuggestView::updateSelectionHighlight`
- `rayneo::app::NotificationSuggestView::updateActionHighlight`
- `rayneo::app::Notification::headGestureCallback`
- `rayneo::app::Notification::updateSuggestGestureState`

这些名称组成一条合理的候选路径：“通知按键 → 选择建议动作 → 高亮 → 提交当前动作”。**路径目前是推断，未从函数体确认跳转关系、旋转事件码、按压映射及场景分支。**

同一 Notification 组件还有 moveReplySelection、updateReplySelection，但这些可能属于普通消息回复区域；不能移花接木地作为待办建议卡支持旋钮的证明。

符号表位于上游实验固件研究目录；其构建脚本把该表复制到经原厂基线准备的目录使用，可作为静态线索。本次未获取对应 AP 函数体、未核验每个符号对用户当前固件的精确匹配，不把实验目录名称当成原厂能力认证。

## 4. 当前鸿蒙实现缺口

当前 ProbeSession 已把 business 21 消息交给通知模块；但 NotificationSession 的接收过滤只接受 type 3、4、18，type 34 会被直接忽略。

因此现有“文字通知”页不能验证本次建议卡的结果，也不能用“没有收到回调”认定眼镜不支持。需要独立接入 type 33/34/35 的完整生命周期，与普通通知分开维护 UID 和状态。

上游已存在 `HeadControlNotificationTest.swift` 和两个 Suggestion codec，可借鉴字段、匹配、超时与移除流程；它们不是可直接在鸿蒙运行的组件，其测试页文案把 accept/reject 写成点头/摇头也不构成原始动作来源证据。

## 5. 对 Agent 请求的产品设计

### 首选：原生二态选择卡

将一个明确动作写进自定义内容，例如“是否让 Agent 按方案 A 继续整理？”，沿用原厂接受/拒绝语义。旋钮如果实测能移动动作焦点，就使用原有选择机制，再检查点头是否确认当前焦点，还是始终代表接受。

手机维护 suggestUID 到 request_id、版本、Agent 会话和期限的映射；不将 Agent 请求写成真实日程或待办。需要先确认原厂按钮、成功动画是否仍固定写“已加入待办”：如果是，这种文案会误导用户，需标为通用决策卡的体验缺口，不能只靠后台改语义就称正式完成。

收到操作后先持久化本地答案，再返回与该动作一致的回执；服务器/电脑收到、继续执行与最终完成是后续独立阶段。超时、重复、旧 UID 和旧连接事件不能误触另一个任务。

### 多选项扩展的条件

- 若固件已提供可变动作列表：核实字段、数量限制与动作标识，再支持 2–4 项。
- 若固件仅有二态结果但允许在手机观察旋转并更新卡片：可研究手机维护当前候选，卡片显示“方案 1/3”，确认接受当前项。必须验证旋转回传、内容更新及焦点稳定，不能把这个机制当作现成能力。
- 若只有 accept/reject，没有旋转回传或本地多选布局：手机无法凭空给镜片增加旋转选项。可研究逐个二选一或语音回答，但不宣称实现了旋钮多选。
- 若旋转在固件内被忽略且没有外发事件，增加该行为需要眼镜侧改动。此时保持原厂二态流程，另行讨论固件路线。

## 6. 最小验证矩阵

先用原有真实待办弹窗观察旋钮，再用本项目的隔离测试卡验证协议；每次仅一张卡，使用唯一 UID。测试选择只记录结果，不创建待办或执行 Agent 任务。

| 步骤 | 操作 | 记录内容 |
| --- | --- | --- |
| T1 | 原厂待办弹窗中向两方向缓慢旋转 | 是否出现/移动高亮，是否滚动正文，是否退出或无反应 |
| T2 | 两个焦点位置分别短按 | 是否确认当前项；不能只观察弹窗消失 |
| T3 | 改变焦点后分别点头、摇头 | 动作是固定接受/拒绝，还是确认当前项；避免猜测统一映射 |
| T4 | 独立 App 下发 type 33 测试卡 | 自定义标题、来源、正文是否显示；按钮和反馈动画是否固定 |
| T5 | 重复 T1–T3 并观察 business 21 全部类型 | type 34 的 UID、suggestType、cmd；是否有其他可观察旋转事件 |
| T6 | 对匹配操作返回 type 35；独立测试移除与超时 | 成功/失败反馈及清理顺序；同一 UID 是否去重；本地收件与服务器处理边界 |
| T7 | 智记中弹卡、断连重连、正常通知插入 | 采集是否受影响、是否抢焦点、是否遗留卡片或误投回调 |

完成 T1–T3 即可初步回答“原厂已经有旋钮选择吗”；完成 T4–T7 才能回答“我们的 App 能否稳定复用”。没看到旋转事件时不能直接认定所有通道都无事件，应结合设备画面、路由过滤和函数分支判断。

本次未连接或操作硬件，以上为下一步验收规格，不是实测结果。

## 7. 本地证据索引

- [官方 App 模型](../../reverse/blutter-out/asm/venus_flutter_app/common_services/glasses_service/notification/notification_ble_model.dart)：建议卡、操作和回执模型。
- [官方 App 对象枚举](../../reverse/blutter-out/objs.txt)：搜索 OperateSuggestCmd、OperateSuggestAckCode、NotificationMsgType。
- [官方 App 常量池](../../reverse/blutter-out/pp.txt)：发送建议、挂接 0x22 事件、UID 匹配和回执的日志/常量。
- [上游建议卡编码](../../ref/Turbo-IO/rayneo-display/Sources/RayNeoDisplay/SuggestionCardJSONCodec.swift)。
- [上游操作及回执编码](../../ref/Turbo-IO/rayneo-display/Sources/RayNeoDisplay/SuggestionJSONCodec.swift)。
- [上游隔离测试页](../../ref/Turbo-IO/apps/RayNeoCompanion/Sources/HeadControlNotificationTest.swift)。
- [固件研究符号表](../../ref/Turbo-IO/firmware-research/strix-1.0.4.12/native-navigation/focus/symbols.json)及其[构建脚本](../../ref/Turbo-IO/firmware-research/strix-1.0.4.12/native-navigation/focus/build.py)。
- [当前鸿蒙接收过滤](../../rebuild/harmony-sdk/entry/src/main/ets/NotificationSession.ets)与[业务路由](../../rebuild/harmony-sdk/entry/src/main/ets/ProbeSession.ets)。

外部检索未提供该弹窗旋钮行为的精确公开实测证据；结论以上述本地材料及用户实际观察为依据。

## 8. 原始参考固件的建议卡退场路径（2026-10-15追加）

本节是新增的函数体证据，不覆盖第1–7节的历史研究范围。来源为上游研究者重新打包的官方App缓存原始成员`StrixOS-1.0.4.12-ORIGINAL-rollback.zip`，ZIP固定SHA256为`22c1d844a7b30715f7f2406032042a2caa74a4442e2bd9437c1ac67a6e3990a3`，内含原始AP SHA256为`53afdf5298815849eafca6f315a70606d2a605aff2e563f79050f797d615a988`。ZIP在内存核对后未留副本，仅保留一份9466560字节原始AP；未下载改版固件、未刷写或修改固件。下载来源并非原OTA服务器原ZIP，也不构成可安全恢复设备的保证。[原始证据](../../rebuild/phase1/card-duration-stock-2026-10-15.json)保留来源、映射、函数范围哈希及逐地址调用。

| 检查路径 | 该参考AP的函数体结果 | 产品含义及边界 |
| --- | --- | --- |
| 建议卡初显 | `showSuggest`的`0x106f94ec`传5000ms；头势提示循环返回非零时`0x106f94f4`改为8000ms；`0x106f94f8`直接调用显示计时器 | 两个固定分支，不读取普通通知`displayTime`或`focusTime`；未确认当前设备走哪一支 |
| 旋钮改变选择 | 非忙碌、当前建议卡且焦点实际改变后，`0x106f865e`进入重置；`restartSuggestDisplayTimer`的`0x106f39d4`固定传5000ms | 不能宣称所有旋钮事件都会延长；不要求用户不断旋转来补足两分钟 |
| 正常显示超时 | `0x106fc8f0`调用`hideCurrentItem`；action4清空显示状态和建议数据/UID，再通知UI隐藏，`onHide`停止头势检测 | 参考AP能主动收卡，并非必须等App的120秒移除；这一静态链与本次回时间页相符，仍不能代替设备固件匹配 |
| 退场后的动作 | 正常清空提交后，`operateCurrentSuggest`检查仍在显示、kind为建议、非忙碌及非空UID，才能新发type34 | 不能据此排除退场前已发出的迟到type34或所有并发边界；手机保留原UID/版本/期限去重 |
| 普通通知设置 | 普通通知初显读取`displayTime`秒数，交互重置读取`focusTime`秒数；上述建议卡路径均未读它们 | 将普通通知时长设120不能作为延长建议卡的依据；type4/34仍独立 |
| 手机侧保活控制 | 已检查business21分发及直接计时调用未发现可安全暂停/保活建议卡的命令；已找到的暂停调用属于普通通知回复关闭分支 | 不作“所有固件/所有通道绝不可能”的断言，不盲加TTL、不伪造操作type34、不自动每4秒重发 |

该AP的type17设置从默认值开始，type18可在当前设置基础上解析部分字段；Android仅序列化布尔值的实现不能证明固件解析也只有该字段。但这些设置解析能力**不改变建议卡固定5/8秒路径**，也没有已证实的完整设置读回/应用回执。本轮未向设备下发任何设置。

**当前结论**：120000ms是本App待答/清理窗口，尚无证据证明可使镜片连续显示120000ms。固定哈希的原始参考AP揭示了与短暂显示一致的具体固件机制；当前设备固件身份未核对，因此不升级为当前设备精确根因或跨版本承诺。

后续最小方案先交[设计评审](./phase1-design-review.md#建议卡停留期限与待答恢复补充2026-10-15)：原请求/完整草稿持久待答、显式重开同一请求、手机完整回答；超时或手动退场不自动当拒绝/取消，不循环复活卡片。此方案只补可恢复性，不能替代用户已确认的两分钟要求；持续显示差距保持H07-T01开放，未确认前不批量改页面。人工前置与后续集中观察见[验收TODO](./USER-VERIFICATION-TODO.md)，不再重复已确认的焦点、短按、固定头势和回时间页观察。
