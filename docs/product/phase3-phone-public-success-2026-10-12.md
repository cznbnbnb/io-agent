# P31 手机公网单条同步实测通过

后续更新：[0.1.47 日常前台协调器与真机修订/删除/冷启动恢复](./phase3-daily-sync-coordinator-2026-10-12.md)。本页保留最初单条实验及当时边界，不能作为当前全部进展。

日期：2026-10-12，成功上传时间 03:26:24Z（北京时间 11:26:24）。手机 0.1.46 / versionCode 10046，无覆盖安装或固件改动。用户已授权自行操作空闲手机；仅停止本 App 隔离实验进程，未启动录音、智记、字幕，也未上传真实用户内容。解锁密码未写入项目、脚本或调试日志。

## 实际成功的链路

手机 PersistenceLabAbility → HTTPS `https://cznbnb.cn/io-api/v1/` → 服务器实际存储 → 电脑独立查询身份读回：

| 事实 | 证据 |
| --- | --- |
| 手机身份校验 | HTTP 200，phone-harmony，使用既有有效凭据，未新签发或扩权 |
| 手机单次提交 | event_id `live-1791775583037-r1`，outbox attempts=1，server_stored |
| 服务器回执 | receipt_id `d3c2d555-8a1b-4c04-9a82-328040c116fe`，commit_seq=7，stored_at `2026-10-12T03:26:24.948Z` |
| 云端事件对账 | 使用原 phone-harmony 身份读取已接受事件，回执 ID、对象、修订、提交序号和时间与手机相同 |
| 电脑资料查询 | 使用独立 pc-query 身份，material_id `mat-recording-17917755830370000000000000000000`、revision=1、完整 body/原文/来源引用均匹配 |

原文明确为“真机联网自检：合成资料，不是用户内容”，audio=missing。报告：`rebuild/phase1/device-p31-live-sync-success-2026-10-12.json` 与 `phone-public-live-verification-2026-10-12.json`。这是**真机单条合成文字到云端再到电脑查询通过**，不是日常录音自动同步或 Agent 模型端到端。

## 本次发现并修复的调试入口问题

1. HDC 在系统拒绝锁屏启动时退出码仍为 0。启动器原本丢弃返回文本，把启动请求当成功；现在必须有 `start ability successfully`，锁屏错误映射 LAB_SCREEN_LOCKED。
2. 直接向真实应用私有路径传文件返回 permission denied，但同样可退出 0。旧配置因此保留已撤销 phone-live，产生两份真实 401 报告；分别保存为 attempt2/attempt3，不改成成功。
3. 经本机 HDC 帮助及官方文档核对，改用 `file send -b <bundle>` 与 debug mount 相对路径；传完必须确认 FileTransfer finish，并经 `shell -b` SHA256 对比设备文件。冷启动前全程 App 不运行，校验失败不得启动。ASCII 临时路径是 Windows 调用兼容防护；当前直接失败原因实测为沙箱权限，未将中文路径推测当定论。参考 [OpenHarmony HDC 文档](https://raw.githubusercontent.com/openharmony/docs/master/zh-cn/application-dev/dfx/hdc.md)。
4. debug mount 允许传文件，却拒绝 shell chmod/rename/unlink；不再宣称通过 shell 完成了 0600 或原子改名。失败启动时用无令牌配置覆盖固定实验文件，避免保留可复用凭据。成功后也已覆盖为 `{"schema":1,"cleared":true}`，设备及本地 SHA256 均为 `9d9a4bcab042a162f26c54ab00292fedcb724d395ab33388d04d8a575c7a9b2b`。普通手机资料目录未改动；设备断线时覆盖清理仍只能尽力。
5. `/events/{id}` 仅原生产者能读自己的事件。验证器原先误用 pc-query 对账，得到 404；修正为显式 `--phone-credential <私有路径>`，先核对 phone 身份和原生报告，资料查询继续用 pc-query，未放宽服务端访问控制。

本地令牌暂存与接收副本已清理，凭据不进 argv/输出/git。启动器六项合成回归覆盖传输、正在运行拒绝、过期拒绝、传输失败、锁屏零退出及设备哈希不一致。原四项手机证据连接器回归继续保留。

复跑：先确认空闲且冷启动；`powershell -File tools/phase1/run-live-sync.ps1 -Credential rebuild/material-server/private/phone-harmony.json -Producer phone-harmony`。收取该次 run_id 的原生报告后：`node tools/phase1/verify-phone-live-sync.mjs --report <新报告> --output <新证据> --phone-credential rebuild/material-server/private/phone-harmony.json`。勿复用旧 run_id 或覆盖失败历史。实验结束用 debug bundle 传输覆盖固定 sync-target.json 为无令牌标记。

## 仍须继续完成

原生报告 local_sync_state 仍为 local：隔离实验仅确认 outbox 回执，未接日常 MaterialStore 同步标记。P31/P32 仍需真实日常资料自动发现、修订/删除、断网积压与进程重启恢复、同步标记写回。原音上传、凭据轮换、长时间功耗和 AC-QUERY 的真实日常对话分析亦未完成。Excel 本轮未动。
