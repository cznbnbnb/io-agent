# P31 历史资料发现与固定事件身份

日期：2026-10-11。承接[P31队列与传输记录](./phase3-material-outbox-2026-10-11.md)。任务依据为P31增量同步、P32修订/删除及PRD稳定ID、重试去重要求。Excel快照未修改。

## 实际修改及行为

`MaterialSyncDiscovery.ets`提供显式`scan(store, now, maxChecks=32, maxNew=8)`。同一分区使用同一队列和发现实例；每次最多检查指定数量的修订候选、登记指定数量的新事件。上限128候选/32新事件。先r1再r2，包含删除修订；不能把最新正文作为旧修订发送。扫描游标仅在内存，重启后从头扫描并依据耐久队列跳过已登记修订。新的修订和排在当前游标之前的新资料在下一轮补到。

每个候选的`enqueueRevision`由队列负责：事件ID/幂等键由版本标识、owner、producer、server、material、revision共同导出；首次发现时固定created_at及七日期限。身份摘要不是鉴权凭据。实际网络仍需要独立Bearer和identity核对。不同服务/用户分区不会共享事件或回执。

正文先发布、账本尚未发布时崩溃，会留下孤立载荷。下次恢复读取原载荷中的日期，按原不可变资料重新构造并逐字节核对后登记；不会生成新的期限覆盖它。损坏载荷保留并报错，不自动覆盖。一个对象缺失历史修订时不跳过去发送其后续版本，但其他资料仍能发现。错误报告只含受控错误码和资料/修订引用，不保存平台异常路径或正文。

扫描只新增旁车队列，不改MaterialStore、不删除原音、不读取凭据、不启动网络。已过期/被阻塞项保持原状态；此次不通过换事件ID回避冲突或假装完成补传。

## 桌面验证

真实临时文件测试覆盖：历史全文和墓碑、候选/新增预算、重启固定身份和期限、载荷发布后账本故障恢复、缺失修订与其他对象共存、损坏孤立载荷保护、过期项不偷偷重发、晚到修订及游标前插入。

新增本机HTTP联测使用真实SQLite服务，发现的r1原文、r2更新、r3删除依次201；手机侧队列接收各自server_stored回执，服务提交序号为3，删除后查询410。重启再扫描不新增提交。该联测运行在电脑，不能代替手机HTTPS验证；合成文字不能代替用户当天资料的AC-QUERY验收。

完整应用522项、契约5项通过。首次ArkTS构建因构造器参数字段声明不支持而失败，改为显式字段和赋值后通过；桌面TypeScript转译通过不等于ArkTS编译通过。

## 0.1.42 真机证据

修正后ArkTS构建23.432秒、签名36.900秒通过，保留已有异常处理/第三方sourceMapsPath警告。HAP447595339字节，SHA256 `d967507464690d0c503c749af9c47b0d6b2fec9e9a7cc8a71923fa4e75937776`。七项源码与staging逐一SHA匹配；签名包ABC包含MaterialSyncDiscovery、MaterialOutbox及seed/resume入口，见[构建清单](../../rebuild/phase1/candidate42-source-manifest.json)。

手机无活动应用进程时覆盖安装，bm实际读回0.1.42/10042。独立Ability在新合成目录创建r1旧文字、r2新版、r3墓碑，每次只检查/新增1项；先登记并领取r1。确认本实验PID后force-stop，确认旧PID消失，以同一run_id重新启动；新PID不同。恢复扫描补齐r2/r3，r1仍保留原event_id/hash/期限，首次领取为lookup，后两项attempts为0，三个receipt均为空，MaterialStore仍为local。

从手机实际读取三份payload文件，独立脚本核对P14 1.1 schema、固定事件ID、全文、删除操作、UTF-8字节数、SHA及顺序。原生发现没有调用网络，也没有注入server_stored合成回执。手机到真实服务的HTTPS仍未通过，不能把桌面HTTP与真机文件实验合成端到端结论。

证据：[首次发现](../../rebuild/phase1/device-p31-discovery42-seed.json)、[重启恢复](../../rebuild/phase1/device-p31-discovery42-resume.json)、[进程证明](../../rebuild/phase1/device-p31-discovery42-process.json)、[实际载荷](../../rebuild/phase1/device-p31-discovery42-payloads.json)、[独立核验](../../rebuild/phase1/device-p31-discovery42-verification.json)。最后仅停止属于本实验的进程并提交熄屏，见[最终状态](../../rebuild/phase1/device-p31-discovery42-final-state.json)。未启动采集、蓝牙、网络或Agent；未修改Excel快照。

## 剩余及限制

- 生产唯一协调器、生命周期/网络策略、凭据配置与刷新、真机HTTPS、积压界面仍未挂接。诊断入口只扫描自己的合成目录。
- 预算约束候选数/新增数，不声称严格限制总I/O时间：MaterialStore当前枚举目录和修订文件仍可能随历史增长。大规模历史性能/异步分批索引尚待实现。
- 账本1000项/64MiB上限、孤立文件物理配额与GC仍需设计。未为了腾空间丢弃原件或确认记录。
- 0.1.43已补充[过期换发和先对账状态机](./phase3-material-renewal-2026-10-11.md)的显式组件与隔离验证，生产自动策略及冲突合并仍需后续实施。发现本身不会解除这些阻塞。
- 当前服务要求连续CAS修订，删除也要依次提交历史链。离线删除后压缩未发送历史的协议优化未实现，不能声称仅上传墓碑已可用。
- 真实采集/ASR及P22零帧问题、原音独立归档和官方BASE验收不由本次合成发现实验关闭。
