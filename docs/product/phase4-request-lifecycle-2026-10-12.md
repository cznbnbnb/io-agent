# P44：问题过期、任务取消后的等待收尾

日期：2026-10-12。承接 Hermes 固定 CLI 接入、真实模型取消和执行不明对账。本批未操作手机、眼镜或生产服务。Excel 只在用户单独要求时更新，快照提交为 `220190b`，不随本批测试刷新。

## 已修复的问题

原来问题到期只在提交答案时拒绝，详情仍可能显示 pending，电脑持久等待也没有服务器确认的结束条件。父任务取消后，手机缓存里的问题还可能保留回答按钮。不能直接根据电脑时钟判定“用户没有回答”，也不能把问题关闭作为任务取消成功。

现在服务器提供可协商的 `request_lifecycle_v1`：电脑对自己已跟踪的问题执行同版本条件裁决。服务器在一个事务内把问题关闭并写独立请求回执。已接受答案优先保留，原问题信封、正文、ID、版本、event_id 和期限均不改；不会假造 task_resumed/task_completed/cancelled 任务事实。

新接口和正常、重复、过期、离线恢复、取消中样例见[契约](../contracts/README.md)与[合成样例](../contracts/request-lifecycle.json)。未升级的线上服务没有 capability，连接程序继续原 GET 轮询；不得据兼容路径宣称过期收尾已上线。已声明 capability 而接口失败时保留等待记录并报错，不自动降级。

## 代码范围

- `material-server/store.mjs`：按服务器时间和父任务状态裁决；`http.mjs` 提供严格认证、JSON、请求体及查询参数限制。数据库仍为 schema 2，没有数据迁移或清理。
- `agent-bridge/client.mjs`：检查版本、服务器时间、原因与状态的对应关系，以及关闭回执。`bridge.mjs` 保留同问题等待、处理 stale 后详情、网络失败后的重启补收尾；只在适配器接受后清除等待记录。
- `TaskWire.ets` / `TaskPanel.ets`：回答入口要求问题未到期、没有答案，并找到同 task/route 的可回答父任务。使用完整缓存查父任务，不依赖页面只显示的最近20项。缺父任务、取消中、执行不明及终态均禁用。提交时仍沿用原有刷新问题/父任务及服务器 CAS，页面检查不是提交授权。
- 候选升级为 0.1.51 / 10051；DevEco OHPM/Hvigor 编译成功，HAP 内 module.json 的版本已独立读回。只生成未签名候选，手机最后安装版本仍为0.1.50。

## 验证与证据

[汇总报告](../../rebuild/phase1/request-lifecycle-result-2026-10-12.json)记录实际范围、源码 SHA、候选包 SHA/版本及未验收项。不能把下列数量相加作为产品验收分数。

| 范围 | 结果与实际覆盖 |
| --- | --- |
| 鸿蒙应用离线回归 | 602项通过，执行实际 TS/ETS，平台接口为显式替身；包含回答入口与已有录音、转写、资料和同步回归。不能证明手机 UI 或后台运行 |
| 服务端与连接程序 | 124项通过。真实临时 SQLite、HTTP 回环及独立进程；新增服务器时钟、事务回滚、三个进程只写一次关闭、丢回包后重启、旧服务兼容及矛盾响应保留等待 |
| 问题契约专项 | 8项通过，含五组共享样例在实际持久服务上执行；与上行有重叠，仅共享样例项为后加验证 |
| 真实 Hermes 模型与 CLI | 8项通过。原任务回答/FIFO/运行和排队取消/正常重启，再增加原问题同版本撤回、独立请求回执、迟到答案 REQUEST_CLOSED 与取消后下一任务 |
| 实际 ACP/MCP 过期等待 | 8项通过，模型为合成。真实工具 wait 在本地期限过去后仍等待服务器裁决；收到 expired 后无 answer/consumed/task_resumed，原问题只调用一次，下一任务完成 |
| 执行不明对账回归 | 11项单元与9项本机完整集成通过。模型、人工裁决为合成；实际子进程异常退出和恢复队列，未重放旧任务 |

真实模型报告为 `hermes-real-provider-cancel-2026-10-12.json`；实际安装版过期工具链报告为 `hermes-managed-lifecycle-runtime-2026-10-12.json`；对账报告为 `hermes/verification/reconciliation-result.json`。均保存所依赖源码 SHA，汇总脚本检查当前源码仍匹配，不把历史通过套到新代码上。

首次应用回归误用默认 macOS DevEco 路径，随后沙箱运行又在临时目录原子 rename 上遭 EPERM；失败日志保留。设置本机 DEVECO_HOME 并按正常主机权限执行后602项通过，没有据权限错误修改业务条件。

本批首次真实模型复跑在4项后失败，旧验证器把非纯错误码异常归为 REAL_PROVIDER_TEST_FAILED，未保存足够细节，**原因未确定**。记录保留为 `request-lifecycle-hermes-provider-attempt1-2026-10-12.json/.log`。验证器现只保存白名单错误码和 syscall，不保存路径、模型错误正文或密钥。重新建立全新合成任务后8项通过，原失败任务没有重发。一次成功不能排除偶发运行失败，仍列为长稳定位项。

## 复跑

```powershell
$env:DEVECO_HOME='D:/APP/DevEcoStudio'
& 'D:/openclaw/nodejs/node.exe' --test rebuild/harmony-sdk/tests/*.test.mjs
& 'D:/openclaw/nodejs/node.exe' --test rebuild/material-server/tests/*.test.mjs rebuild/agent-bridge/tests/*.test.mjs
& 'D:/openclaw/nodejs/node.exe' tools/phase1/verify-hermes-runtime.mjs --with-lifecycle
& 'D:/openclaw/nodejs/node.exe' tools/phase1/verify-hermes-provider.mjs --run-provider --with-cancellation
```

过期集成只使用安装版运行时与合成模型；真实模型命令会使用已配置服务并新建独立测试 home。prepared Python、对账复跑和私有目录沿用[CLI接入](./phase4-hermes-cli-provider-2026-10-12.md)和[对账说明](./phase4-runtime-reconciliation-2026-10-12.md)。汇总脚本 `tools/phase1/summarize-request-lifecycle.mjs` 只检查已经完成的测试与约定日志，不替代测试。

## 未完成与后续依赖

本篇验证时本机实现尚未部署；后续 2026-10-13 已授权发布 r2，并通过公网合成 owner 的认证问题收尾验证，见[发布记录](./phase4-lifecycle-release-2026-10-12.md)及[云端记录](./phase4-cloud-hermes-2026-10-13.md)。手机任务凭据、实际启用任务同步、手机真实首答/取消、眼镜问题与语音、多选、真实模型过期策略仍未验收。电脑离线时没有服务器全库后台扫描；回来后按跟踪列表补收口，手机仍需刷新已有详情。服务器拒绝过期答案不意味着手机已经展示关闭状态。

人工对账、旧CLI/TUI接入、崩溃后原工具调用栈恢复、答案/取消/问题关闭投递不明的恢复、生产凭据登记/轮换、容量和8小时稳定性仍未完成。首次任务接收已补充[限定对账](./phase4-intake-reconciliation-2026-10-12.md)，不覆盖其余交接。P43/P44、AC-ASK/AC-VOICE/AC-OFF不关闭。

下一批先准备服务扩展的可回退发布包与具体生产身份登记，再在手机恢复可用后验证任务页首答/取消和云端路由。手机不可用期间继续电脑运行时边界与P20–P25独立缺陷；官方BASE-01–10、全天功耗、双人识别和多设备仍是正式交付门槛，P13大范围页面改写仍待设计确认。
