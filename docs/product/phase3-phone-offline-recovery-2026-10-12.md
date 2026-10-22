# P31/P32 真机断网积压恢复与逐项查账

日期：2026-10-12 13:02–13:12（北京时间）。0.1.48 / versionCode 10048 已覆盖安装。延续[前台同步协调器](./phase3-daily-sync-coordinator-2026-10-12.md)，本轮未更新 Excel。

后续：已推进[0.1.49 手机任务收发组件与真机文件恢复](./phase4-phone-task-mailbox-2026-10-12.md)。它是独立任务协议客户端的增量，不代表本文的资料同步已变成 Agent 任务完成，也未关闭下列 P31/P32 剩余项。

## 真实设备结论

手机短暂关闭 Wi-Fi 与移动数据，蓝牙保持原状态。HDC NetConnManager 显示 NetId=0、ConnStat=0；原生 `connection.hasDefaultNet()` 在本轮前后均为 false。使用真实既有 HTTPS 目标与 phone-harmony 凭据，没有替换成错误域名或模拟网络错误。

隔离 run_id `1791781276402` 创建标注为合成的原文、修订和删除标记。断网时身份预检真实失败，coordinator_note=IDENTITY_UNAVAILABLE；三个版本都落在本机 outbox，state=queued、attempts=0、无回执，最新视图仍为 queued/storedRevision=0。

脚本 finally 恢复原先开启的 Wi-Fi/移动数据；私有截图核对两个开关均开启，NetConnManager 恢复 NetId=127、ConnStat=1、IsAvailable=1。停止 PID 10881 后冷启动 PID 12207，原生网络检查前后均为 true；原来三个事件沿用相同 ID、payload_hash、字节数、期限及版本，各发送一次。

| 修订 | 真实提交序号 | 回执 ID |
| --- | --- | --- |
| 原文 v1 | 11 | acd8e7c6-e18f-4d5e-a4e3-3ada65ddc531 |
| 修订 v2 | 12 | 8285a4c8-da6f-420a-8dd3-5b3e0f7c73ee |
| 删除 v3 | 13 | e72f7ccf-8f76-4aea-b2af-44d04a655b62 |

电脑用原手机身份逐条核验回执，独立查询身份确认 MATERIAL_DELETED / 410 与相同 v3 删除增量。证据：`rebuild/phase1/device-coordinator-offline-2026-10-12.json`、`device-coordinator-online-2026-10-12.json`、`phone-offline-recovery-verification-2026-10-12.json`。

这是**真实无默认网络时本机积压、恢复网络并冷启动后补传通过**。断网发生在身份预检之前，不能推出手机 POST 后丢回包/途中掉网已通过；后一项仍只有组件证据。没有访问日常资料、启动收音或执行 Agent 任务。

## 恢复入口代码

- 受阻与过期资料逐条列出时间、类型、版本和受控原因，最多显示前 20 项。身份失败、无网络、回执异常与损坏分别提示。
- “重新查账”只处理所选、当前主体绑定的行，先 GET 原事件，不批量解锁或换 ID。有回执即恢复已存储；未收到但有效才沿用原事件补传。
- 过期投递须先取得身份验证后的 EVENT_NOT_FOUND / retryable=false，才允许“补传此版本”。显式补传生成新期限，保持正文/资料版本并保留旧信封谱系。发现流程不自动续期。
- 损坏发送副本不能用恢复按钮解锁；原件保留。配置关闭、切换、同步忙及旧账户行均拒绝恢复。
- 设置晚返回不会改变已收起/离开的 UI；观察回调异常不改变保存结果。实验页按阶段区分文件实验与 HTTPS，联网实验不再写成“不上传”。

逐项恢复、过期续发及错误提示已有组件回归与原生编译，**硬件上尚未制造真实冲突/过期来点击这两个恢复按钮**。

## 日常页面走查

普通 EntryAbility → 功能 → 智记：已有绑定自动重连显示“已连接”；页面为“开启全天智记”“开始录音”，未开启采集。同步显示“未开启、待同步 0、已存文字版本 0、需处理 0”。

展开设置，五个同步字段均为空且可编辑，“立即同步”禁用；重读后仍关闭，收起后无可见凭据输入。未保存配置、填入实际令牌或启用真实历史上传。脱敏记录 `rebuild/phase1/device-sync-ui-smoke-2026-10-12.json`；原始屏幕/布局调试资料留在忽略目录，不上传或提交。

实验目标文件已用无令牌标记覆盖并核验 SHA256。仍用既有有效凭据，未签发新凭据、扩权或修改生产网站。GET_NETWORK_INFO 只用于默认网络检查，权限/API 经本地 SDK 声明核对。

## 验证与未完成项

相关回归 46/46：单条查账、未确认不存在时禁止续发、正文/版本保持、账户隔离、损坏保护、真实本机 HTTP/SQLite、离线前置条件及冷启动器。完整 App 回归 565/565，契约回归 5/5。候选编译、签名、覆盖安装通过，既有依赖警告仍在。完整 App 日志为 `sync-recovery-app-regression-2026-10-12.log`。

P31/P32 仍需真实日常历史启用与持续同步、POST 后不确定结果真机恢复、原音独立上传、后台网络租约/功耗、凭据轮换及账本容量治理。P43 手机文字委托仍需独立任务/请求/答案客户端和真实运行时路由，资料回执不能冒充 Agent 完成。

复跑：在实际默认网络关闭时用 `run-live-sync.ps1 -Phase coordinator-offline` 创建 run_id；恢复原网络并停实验进程后用 `-Phase coordinator-online -RunId <原run_id>`。显式指定既有 phone-harmony 凭据/producer，令牌不进 argv。收取报告后：

```
node tools/phase1/verify-phone-coordinator.mjs <offline-report> <online-report> <output-json> --offline
```

结束必须恢复网络并将实验目标覆盖为无令牌标记。禁止用连接中的设备跑离线阶段、改域名或替换成功报告制造结果。
