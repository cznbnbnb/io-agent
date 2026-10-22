# P31 手机发送队列与真机恢复记录

日期：2026-10-11。手机候选 **0.1.40 / 10040**；承接[P30本机资料服务](./phase3-material-service-2026-10-11.md)。本轮没有改变Excel进度快照，按用户要求只在明确要求更新表格时修改。

## 实际代码

- `MaterialOutbox.ets`：按owner/producer/server三者隔离的文字事件旁车队列。固定事件JSON、ID、期限、原始字节SHA256先写文件并fsync/rename，再发布状态。不会在重试时读取最新资料替换旧正文，也不把原音或MaterialStore标记为已上传。
- `MaterialSyncTransport.ets`：显式单次pump，HTTPS、禁止重定向、禁缓存、响应限16KiB、有限连接/读取超时。Bearer只在请求内存中使用。先GET identity核对真实owner、producer、server和write scope，再领取发送项，避免配置误标令牌归属后把正文存入另一个owner。
- P30服务新增GET `/v1/identity`，server_id耐久保存在同一数据库，重启后不变，新库新ID；凭据撤销/期限照常生效。没有公开注册、发令牌或执行任务的接口。
- `PersistenceLab.ets`新增outbox-seed/resume/check三段隔离实验，仅合成资料、合成回执，不调用网络、蓝牙、录音或模型。生产资料发现/网络调度未自动接入；现有multipart每日上传入口不被偷换为新协议，也不能作为新队列的确认依据。

## 状态及恢复规则

queued/sending/reconcile/retry_wait/server_stored/expired/blocked分别表示本地投递状态。sending在进程重启后转reconcile，先GET原event_id查询；404且未过期才发送相同字节，过期则停止。网络结果不明、429或5xx都先进入需对账的退避态；指数1/2/4/8秒，30秒上限后加0–20%抖动，遵守更长的Retry-After。期限已经过了但结果仍不明时仍可查询存储状态，不把“本地到期”误当成服务器未接受。

同资料rN要等rN-1确认为server_stored，其他资料可继续。成功只接受匹配schema/event/material/revision/receipt subject的server_stored，不接受glasses_displayed等其他业务回执。400/403/409不会自动盲重试；401等待凭据修正，修正后也先对账。取消网络操作保留“不明”状态，迟到回调用持久attempt和运行代次隔离，不能覆盖新状态。旧协调实例发现账本变化后拒绝覆盖。

此组件要求同一分区只有一个App进程内协调器。账本摘要检测能拒绝顺序发生的旧实例写入，**不是跨OS进程的原子互斥锁**；正式接AppRuntime时应共享唯一协调器，不在每页创建一份。当前上限为1000条已登记项/64MiB已登记载荷，满时保留本地原件并报OUTBOX_FULL，不静默删旧数据。崩溃留下的未登记载荷不自动清除，物理目录容量/GC仍需后续策略。

## 已执行验证

1. 桌面真实文件与本机HTTP：固定载荷持久化、修订等待、跨主体/服务隔离、退避、错误回执、磁盘发布失败、载荷损坏隔离、旧实例防覆盖。ArkTS队列使用真实文件，向真实SQLite服务POST后丢掉回复，再重启队列通过GET event找回原receipt；DB只产生一次效果。
2. 网络组件替身验证：身份不匹配时不发送正文；HTTPS/重定向/缓存/响应限额参数；POST后网络异常对账；cancel后迟到成功不落账；预检429遵守Retry-After。这部分没有假称真机HTTPS已通过。
3. 完整应用 **513项**、P14契约 **5项**通过；服务新增身份接口后 **18项**真实本机测试通过。应用回归见`rebuild/phase1/final-tests.log`，服务记录见`rebuild/material-server/verification/`。数量只描述执行范围，不代表产品验收覆盖率。
4. 真实ArkTS编译58.593秒、签名36.836秒通过；已有类型异常处理提示及第三方sourceMapsPath警告仍在。签名HAP **447554748字节**，SHA256 **e381d8a19c7cf8def329077361f31c3121a1d71037d9289ed111c2d30a953260**。6项当前/ASCII staging源码逐一SHA核对，见[candidate40-source-manifest.json](../../rebuild/phase1/candidate40-source-manifest.json)。
5. 确认本App无活动进程后覆盖安装，bm实际读回0.1.40/10040。手机独立Ability三阶段通过，**两次真实force-stop并确认旧PID消失，三次PID不同**。首次恢复先查询原event、拒绝旧callback、相同字节重试、模拟存储回执后释放r2；第二次恢复保留r1合成receipt和r2的retry_wait/attempt/期限/lookup状态。独立验证器再次核对报告中的载荷SHA、大小、对象版本和进程证据。

真机公开证据：[种子](../../rebuild/phase1/device-p31-outbox40-seed.json)、[恢复](../../rebuild/phase1/device-p31-outbox40-resume.json)、[二次重启](../../rebuild/phase1/device-p31-outbox40-check.json)、[进程证明](../../rebuild/phase1/device-p31-outbox40-process.json)、[独立核验](../../rebuild/phase1/device-p31-outbox40-verification.json)。均为合成数据。运行ID/PID原记录在忽略目录device-private中。

打包范围补核：直接检查签名HAP的ets/modules.abc，包含MaterialOutbox和outbox-seed，但**不包含尚未挂接入口的MaterialSyncTransport**。因此0.1.40证明队列进入原生包；传输组件目前只有源码/桌面替身证据，不将“文件被复制到staging”当成它已通过ArkTS编译。后续须挂接合法调用入口并再次编译、核对字节码及真机验证。

**这次真机只证明原生文件、SHA及进程恢复。server_stored字段使用合成回执，不能作为真实服务器接受证据；真实服务器落盘证明来自另一个桌面loopback联测。两项证据不能拼成手机在线端到端。** 最后仅停止本实验进程并提交熄屏；未启动采集、蓝牙、网络和Agent，见[最终状态](../../rebuild/phase1/device-p31-outbox40-final-state.json)。

## 未完成

### 0.1.41 原生传输组件补核

新增仅校验配置的`validateTarget`入口并由独立PersistenceLab调用，使传输模块实际进入ABC。禁止HTTP、含URL凭据和分区不符的目标；不发请求、不入队、不读取生产资料。队列账本及孤立载荷在读取前增加文件大小核对。桌面测试的NetworkKit默认替身会在任何未注入的网络调用时抛错，旧资料实验仍可运行。

完整应用514项及契约5项通过；ArkTS编译58.666秒、签名37.260秒通过。签名HAP447574824字节，SHA256 `7b5385fd7c1ce4711cf6ecc984154c0b230bd2d178e297844fdeb82839bccf58`。直接读取签名包ABC，`MaterialOutbox`、`MaterialSyncTransport`、`outbox-transport-guard`均存在；当前源码与staging六文件SHA匹配，见[candidate41-source-manifest.json](../../rebuild/phase1/candidate41-source-manifest.json)。

在应用无活动进程时覆盖安装，bm读回0.1.41/10041。真机四项目标校验通过，events/outbox均为空、claim为空；独立脚本再次核对报告字段、检查项及文件SHA，见[真机报告](../../rebuild/phase1/device-p31-transport41-guard.json)、[独立验证](../../rebuild/phase1/device-p31-transport41-verification.json)。最后确认属于本实验的PID后停止并提交熄屏，见[最终状态](../../rebuild/phase1/device-p31-transport41-final-state.json)。

这补齐了传输源码的原生编译和配置执行证据，**仍未证明真机HTTP请求、HTTPS信任链、真实服务器存储或端到端同步**。0.1.40重启恢复记录保持原版本与原范围，不追认成0.1.41回归；Excel快照未修改。

P31/P32还未完整交付。0.1.42已补充[按历史修订发现入队及真机恢复](./phase3-material-discovery-2026-10-11.md)，0.1.43补充[先查账的过期换发和账户切换隔离](./phase3-material-renewal-2026-10-11.md)，目前仍是显式组件和隔离诊断入口；生产唯一协调器与生命周期挂接、手机到真实服务的HTTPS联测、账户登记和凭据刷新、自动换发策略、冲突合并/删除传播、超大文本分块、原音独立上传及网络策略、积压用户界面仍需开发。文件fsync+rename已验证强停恢复，突然断电/磁盘满长期恢复未实测。没有以这批结果关闭P22零帧采集问题、官方BASE差距或PRD的AC-QUERY等最终门槛。
