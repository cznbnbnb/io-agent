# P31/P32 过期投递恢复与账户切换隔离

日期：2026-10-11。任务依据为PRD资料耐久性、期限、去重、独立凭据和离线恢复要求。承接[历史修订发现](./phase3-material-discovery-2026-10-11.md)。Excel快照保持不变。

## 修改及状态规则

`MaterialOutbox`新增显式`recheckExpired`与`renewExpired`。本地过期只会停止发送；它不证明服务器未接受。先用原event_id查账：已有匹配server_stored回执则完成原项；网络未知、401/403、普通404不能授权换ID。只有期限已到且查账得到P14 `schema_version=1.0 / EVENT_NOT_FOUND / retryable=false`，才耐久记录该事件的不存在确认。

换发只更换event_id、idempotency_key、created_at、expires_at，资料body逐字节保持原版本，不从最新文字重建。新ID由分区及旧事件ID确定，换发发布后重放本地调用会返回已有继任项。旧payload文件和事件/校验/期限/不存在确认关系保留。新payload发布后账本未发布的崩溃，恢复读取该payload的原日期并核对完整信封，不能悄悄延长期限。旧回调不能确认继任项。

账本升级为schema 2，读取schema 1时给原项补零确认和空历史，首次写入发布schema 2。未知版本报错并保留文件。0.1.42及更早队列组件不理解schema 2，应拒绝读写；不声称这些队列能降级继续发送。MaterialStore及用户原音格式未改变。

每条修订最多保留16次换发历史；历史载荷也计入64MiB已登记额度，账本仍限2MB/1000项。达到上限会报错并保留原件，不自动删除。突然断电/磁盘满长期恢复、孤立文件物理配额及GC仍未通过。

## 同批补齐的账户隔离

源码检查发现潜在配置竞争：协调器重复初始化失败可能残留旧行，identity等待期间切换分区或修改目标配置可能混用后续请求。此前传输组件没有接入生产上传，本批没有声称已有用户资料受到影响。

现在初始化开始即停用旧内存状态，只有完整加载/恢复成功才可使用。claim携带分区摘要，finish必须匹配；相同event_id和attempt在另一个账户也不能接受旧callback。传输一次pump固定启动时的目标快照，并在identity后、落账前检查队列分区。账户改变则返回IDENTITY_CHANGED，不领取/确认另一个分区的资料。正式协调器切换配置时仍应先cancel旧传输。

## 桌面验证范围

真实临时文件覆盖：过期无证明不能换发、错误/普通404不能授权、正文与旧载荷保留、旧callback与本地重复调用、发布失败恢复同一继任、schema 1升级/未知schema保护、16次历史上限、损坏载荷拒绝、初始化失败停用、相同event ID跨分区callback拒绝。

真实本机SQLite/HTTP覆盖两条分支：旧POST已commit但手机未保存回复，期限后通过GET找回原receipt，提交数仍为1；旧事件实际404时换发并成功存储，同一旧过期POST返回410，提交数仍为1。新凭据由本机测试服务在其可控时钟下重新签发，不用过期Bearer冒充事件过期问题。

NetworkKit替身验证账户在identity期间改变不发送新账户文字、迟到POST不确认新账本、目标对象修改不替换进行中的URL/Bearer；这是异步逻辑验证，不是真机网络证明。

## 0.1.43 原生和真机记录

最终源码完整应用535项及契约5项通过；原生构建日志记录`34 s 1000 ms`，签名36.699秒通过。HAP447625949字节，SHA256 `7e8a5adfbf545d66f51b4decffa1258acc1baded0db60059aebd705f7d042bda`。七项源码/staging逐一SHA核对，实际ABC包含换发入口、EXPIRED_ABSENT及IDENTITY_CHANGED，见[构建清单](../../rebuild/phase1/candidate43-source-manifest.json)。已有类型异常处理及第三方sourceMapsPath警告保持记录，没有把警告隐藏为零。

确认应用无活动进程后覆盖安装，bm读回0.1.43/10043。先从手机读取0.1.42实际留下的合成schema 1账本，再用新版本恢复同一实验目录。三个原项的event_id、queue_id、资料修订、载荷SHA/大小、期限及receipt全部保留，schema升级到2，history为空、absence确认仍为0。证据：[升级前](../../rebuild/phase1/device-p31-renewal43-migration-before.json)、[升级后](../../rebuild/phase1/device-p31-renewal43-migration-after.json)、[新版本恢复报告](../../rebuild/phase1/device-p31-renewal43-migration-report.json)。此升级实验只修改本任务拥有的旧合成目录，未读取用户录音或生产资料。

另在全新合成目录生成已过期的短期限事件：验证到期不发送、未查账不能换发、模拟明确404后换发且body不变、旧回调拒绝。真实force-stop并确认旧PID消失后，用相同run_id重新启动，新PID不同；继任事件ID、SHA、期限和单条旧事件关系保留，先lookup继任事件，不再生成第二个继任。原资料仍为local、receipt为空。这里使用合成过去时间，**没有等待七个自然日或声称完成长期离线测试**。

从手机实际读回旧/新payload两文件，独立验证器校验P14 1.1、UTF-8字节数、SHA、body相等、分区摘要、重启及账本升级。证据：[种子](../../rebuild/phase1/device-p31-renewal43-seed.json)、[重启恢复](../../rebuild/phase1/device-p31-renewal43-resume.json)、[实际载荷](../../rebuild/phase1/device-p31-renewal43-payloads.json)、[进程证明](../../rebuild/phase1/device-p31-renewal43-process.json)、[独立核验](../../rebuild/phase1/device-p31-renewal43-verification.json)。

手机实验的EVENT_NOT_FOUND是明确注入的模拟响应，**不证明手机查到了真实服务器的不存在状态**。真实HTTP/存储分支证据来自桌面本机测试，二者不能拼成真机HTTPS端到端。最后仅停止本实验PID并提交熄屏，未启动网络、蓝牙、采集或Agent，见[最终状态](../../rebuild/phase1/device-p31-renewal43-final-state.json)。Excel快照未改。

## 剩余

换发是显式组件能力，生产自动恢复策略与唯一协调器尚未挂接；凭据登记/刷新、真机HTTPS、积压UI、冲突合并、大文本及原音同步仍需继续。确认不存在依赖同一已认证资料服务的响应；不能拿不相关代理404或更换服务器的空库当证明。服务时钟偏差/备份恢复后的全面对账未完成。此处不是任务执行重试机制，不应用于自动重做电脑任务副作用。
