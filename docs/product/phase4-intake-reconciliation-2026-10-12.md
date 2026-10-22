# P44：首次任务接收回复丢失后的查证

日期：2026-10-12。本批继续电脑侧开发，不操作手机或眼镜，不更新进度表，不调用真实模型或办公工具。本功能不依赖新服务端点。后续 2026-10-13 已获用户完整服务器授权并部署 r2，见[发布记录](./phase4-lifecycle-release-2026-10-12.md)；本篇接收故障注入的范围保持原记录，不因此升级为真实模型故障恢复验收。

## 修复范围

连接程序在调用运行时前保存 `prepared`，收到动作后才保存 `responded`。之前只要这段回复丢失，即使 managed Hermes 已经持久接收任务、保留原接收和完成事件，重启也只能停在 `DISPATCH_UNCERTAIN`。

现在 managed 适配器声明可选 `admission_probe_v1`，提供只读 `admission_probe` 帧。连接程序只对原版本1、queued、`allow_create_session=false` 的首次任务投递使用它。投递前已保存的来源、当前对象、运行时身份绑定、确定 operation_id，以及原始接收事件必须全部一致。

运行时同时验证 operation 的原 source、原命令 payload 和事务内保存的 admitted 事件。单独存在 operation 行不够，ACK 后保留的 admitted 事件仍可查证。查询不 claim、不执行、不改账本、不重新发 prompt。

查证成功后仅补回该接收调用确定的空动作响应 `[]`，在 bridge 同一次原子保存中记录接收对账审计。后续任务状态、结果及回执必须沿原运行时事件队列发送。接收对账不能生成任务完成、用户回答或任务继续事实。没有能力、没有原来源、查不到事实或来源冲突时继续保留 prepared；没有根据“查不到”自动重试。

这是对旧 `DISPATCH_UNCERTAIN` 的限定补齐，不适用于答案投递、取消、问题关闭、后续任务版本或任意第三方运行时，也不恢复丢失的工具调用栈。运行时任务本身为 unknown 时，仍需[明确结果对账](./phase4-runtime-reconciliation-2026-10-12.md)，不能因已接收而重新执行。

## 代码与兼容

- `hermes/runtime_journal.py` 只读核对原 admission；`adapter_main.py` 提供匹配请求的 stdio 响应。
- `adapter-host.mjs` 校验能力类型并支持只读交换；连接程序要求该能力同时具有 async_events 和查询方法。
- `bridge.mjs` 核对原始来源、确定ID及来源全文摘要；匹配后跳过可执行 onItem。
- `state.mjs` 增加可选 `intake_reconciliations` 审计映射。老 schema 2 空缺字段按空映射兼容，既有绑定检查保留。审计有容量上限，不自动丢弃证据。运行时 SQLite 仍为 schema 3，没有迁移或清理。

旧适配器未声明能力时保持原停止保护。只读 status 额外报告 `reconciled_intakes` 数量，它不是任务完成数。

## 验证及实际边界

[汇总证据](../../rebuild/phase1/intake-reconciliation-result-2026-10-12.json)保存对应源码SHA和已完成测试范围。

| 范围 | 结果及含义 |
| --- | --- |
| 服务与连接程序回归 | 129项通过。新增匹配事实恢复、无事实保持阻塞、来源变更拒绝和协议能力检查。含真实本机HTTP、SQLite及测试子进程，适配器部分用显式替身 |
| 运行时账本 | 20项通过。新增重启与ACK后只读查证、不重复claim、仅有operation行不能证明接收、来源冲突及查无记录不落库。原进程争抢与硬退出保护保持 |
| 实际安装版 ACP/适配器 | 9项通过。基础原任务问答、排队、取消、重启6项，加首次接收丢回复、重启查证和后续任务3项。模型为合成，无 provider 或办公调用 |

完整集成使用真实适配器、原运行时日志、stdio、认证HTTP和SQLite。故障注入是桥接收到真实适配器回复后丢弃本地响应，使 prepared 留存；原合成任务完成后才停止并重启适配器。重启后原任务 prompt 总数仍为1，原接收及完成事件回到服务器，后续任务完成，接收审计保留。

该故障注入不是新路径的实际进程硬退出证明，也不证明运行中的等待栈可恢复。已有硬退出测试仍验证缺乏可查证事实时保持停止。真实模型CLI的历史8项证据对应此前版本，本批没有据历史结果宣称新探测路径已通过真实模型或云端端到端。

复跑：`node tools/phase1/verify-hermes-runtime.mjs --with-admission`。使用已准备的固定 Hermes Python 与安装版本，或按原验证脚本显式指定路径。只读汇总入口 `tools/phase1/summarize-intake-reconciliation.mjs` 不运行测试、不部署、不改Excel。

仍待完成：生产登记及手机任务链、答案/取消/关闭投递结果不明的恢复、真正进程退出故障下的新路径验收、8小时稳定性、用户既有CLI/TUI接入、眼镜与官方基础体验。P43/P44整体保持未验收。
