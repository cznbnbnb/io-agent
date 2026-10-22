# P44：答案已接收但本地回复丢失后的核对

日期：2026-10-13。继续完整 PRD；本批不操作断开的手机或眼镜，不改 Excel。服务端仍使用已部署的 r2，本功能属于电脑连接程序和 managed Hermes 的适配扩展，不需要新服务端点或数据库迁移。

## 用户可观察结果与边界

连接程序在派发答案前保存 prepared。此前运行时已持久接收、甚至原任务已消费答案并完成，只要本地 stdio 回复没有被连接程序保存，重启仍停在 `DISPATCH_UNCERTAIN`。网络去重无法修复这段运行时交接。

现在增加可选 `answer_intake_probe_v1`：只读核对运行时保留的原问题和确切答案。证明匹配时只补回“Agent 已接收答案”回执，原任务继续、完成及结果仍必须来自原生运行时事件。不会再调用 onAnswer，不生成新问题、新任务或替代会话。

若运行时任务已 unknown，答案接收证明仍只能证明接收，不能重新打开操作或恢复等待栈。没有能力、没有派发前保存的答案快照、查不到记录或来源不一致时保持停止。取消/问题关闭交接不明仍待开发；本扩展不能据“查不到”自动重试。

## 代码与接口

- `state.mjs`：prepared 额外保存不可变答案快照；可选 `answer_intake_reconciliations` 审计与 responded 动作同一次原子保存。旧 schema 2 按空审计兼容，不补造旧快照。审计最多20,000项，达到上限停止，不自动删证据。status 的 reconciled_answers 是接收核对数。
- `bridge.mjs`：核对原 request source、答案快照与当前认证对象，再请求只读证明。验证确定 operation_id、原问题版本、完整来源和答案摘要，只恢复确定的 agent_received 答案回执。正常回执仍经持久 outbox 和服务器去重。
- `runtime_journal.py`：提取与 record_answer 共用的原问题/路由/答案校验。只读快照内核对 questions.state=answered 和原 answer_id/stored_at/body 的字节一致性，允许答案已被消费或操作已终结。无 claim、consume、事件或数据库写入，SQLite 仍 schema 3。
- `adapter_main.py` / `adapter-host.mjs`：声明并检查布尔能力；显式匹配的 answer_intake_probe 帧，不使用异步 stdout 推送，不向模型开放查询其他操作的工具。

请求帧包含 `{id,type:"answer_intake_probe",delivery_id,request,answer}`。delivery_id 固定为 `answer:<request_id>:<revision>:<answer_id>`。request 为派发前保存的原来源；answer 快照包含 kind/object_id/revision/stored_at/body。回复字段 answer_intake 为 `not_proven`，或 `received` 加同一 delivery_id、operation_id、规范化 request 和 SHA256 answer_digest。摘要原文为规范 JSON `{answer_id,stored_at,body}`，不是模型猜测的答案或眼镜原始动作。

## 集成问题与修复

首次实际 ACP 专项在重启查证阶段失败。独立复现确定：Hermes 的期限包含微秒，服务端 Date.parse 只保存毫秒，字符串相等检查误拒绝同一期限。现按服务端有效毫秒比较，增加一毫秒仍拒绝，没有延长期限。失败报告及日志保留为 `hermes-managed-answer-intake-attempt1-2026-10-13.json` 和 `answer-intake-acp-attempt1-2026-10-13.log`。

首次真实模型云端专项的原答案核对已通过，但测试程序只等待首任务完成就停运行时；第二个已领取的任务在 prepare 阶段被中断，正确进入 unknown。只读原生诊断记录首任务 completed/returned/valid，第二任务 unknown 且没有原生结果。修正的是测试时序：正常重启前等待所有已领取 runner 返回；没有把 unknown 改成成功，也没有重放原失败任务。运行中崩溃恢复要求保持未完成。

第二次真实模型专项在进入问题场景前遇到 EPERM/rename，具体文件占用来源未确定。`state.mjs` 增加 Windows 短暂替换拒绝的有界重试：只重试已完整 fsync 的同一临时文件，等待总计最多250ms；每次替换前重新核对所有权。持续失败保留旧账本和临时证据并抛错，不删除原文件或原地写入。没有重试运行时执行或网络任务。

独立源码复审未发现明确 P0/P1 正确性缺陷；修复一个 P2 测试可移植性问题：真实 Windows 文件句柄测试不再写死开发机 Python 路径，支持自动发现与显式配置，缺依赖时记录跳过边界。复审本身不算运行或真机证据。

## 验证记录

| 范围 | 已取得的证据 |
| --- | --- |
| 服务/连接程序 | 140项通过，其中服务58、连接程序及进程/CLI/锁/Windows替换82；新增答案匹配、无证明、错证明、快照变更及旧能力/缺快照停止，日志 `answer-intake-server-bridge-tests-2026-10-13.log` |
| 连接程序正式证据入口 | `node rebuild/agent-bridge/verify.mjs` 在宿主环境82项通过，无跳过。受限环境此前11项网络相关失败保留为 `answer-intake-bridge-restricted-attempt-2026-10-13.json/.tap`；同源码宿主复核通过，未放宽断言 |
| 问题工具 | 18项通过，含消费/终结/重开后只读证明、没有 resume、unknown 不重开、改答案/问题/路由/期限拒绝、毫秒精度与查无记录不写入 |
| 账本/调度/对账/固定CLI | 48项通过，见 `answer-intake-runtime-regression-2026-10-13.log`；模型/裁决为合成 |
| Windows 原子替换 | 3项通过：真实 Python 进程持有不允许 delete-sharing 的句柄，至少一次替换被实际拒绝后恢复；永久拒绝保留原字节且不派发；重试中失去所有权不再替换 |
| 实际安装版 ACP | 修复期限精度后9项通过；真实 stdio、认证HTTP和SQLite，模型为合成。原等待消费一次、重启证明、原事件回传和下一任务完成。故障是显式丢本地回复，未硬杀 bridge |
| 真实模型公网专项 | 11项通过，真实 kimi-k3 + 固定CLI + 腾讯云HTTPS；丢接收回复、原答案实际消费、全部已领取runner返回后正常重启、只读恢复、FIFO及真实取消。原答案执行投递1次；未硬杀bridge。完整报告 `hermes-real-provider-cloud-answer-intake-cancel-2026-10-13.json`；前两次失败另存 attempt1/attempt2 |

证据位于 `rebuild/phase1/`。不同报告保存相应源码 SHA；先前成功不能自动证明后来修改的源码。最后公网专项包含 Windows 替换修复后的代码；较早的9项合成 ACP 专项保留其当时源码范围。实验 d/e/f 三个 owner 的 phone/agent/operations 凭据均已撤销，逐角色公网 identity 均返回401；记录为各 `cloud-answer-intake-20261013-*-credentials-revoke.json`。不把测试数量相加为产品验收分数。

复跑实际 ACP：`node tools/phase1/verify-hermes-runtime.mjs --with-answer-intake`。真实模型专项在原公网命令上增加 `--with-answer-intake`，必须显式 `--run-provider`，使用全新合成 owner 的私有 bundle 和独立登记会话。每次失败/结束均撤销该 owner 的实验凭据并从公网核对401。

## 尚未完成

手机正式路由和凭据登记、手机文字委托/待答页真机、眼镜选择和自由语音、用户既有 CLI/TUI 接管、运行中断后的原工具等待栈、取消/关闭交接不明的核对、真实模型问题过期策略、原音归档、8小时稳定性/功耗及完整官方基础体验仍未验收。P43/P44、AC-ASK/AC-VOICE/AC-OFF 保持开放，不因原答案接收可查证而关闭。
