# 公网 HTTPS 恢复与同步验证准备

日期：2026-10-12 10:45（北京时间）。承接 [P31 原始失败记录](./phase3-phone-live-sync-2026-10-11.md) 与 [后台及期限元数据实现](./phase4-operations-dashboard-2026-10-12.md)。本记录不代表全产品或 Agent 端到端验收。

后续状态：11:26 手机单条合成资料真实上传成功，11:29 电脑独立身份查询及原生产者回执对账通过；锁屏/沙箱传输/对账身份问题及清理证据见[真机成功记录](./phase3-phone-public-success-2026-10-12.md)。以下“待无采集确认、真机未运行”仅为10:45历史状态。另见[Hermes managed runtime 本机联调](./phase4-hermes-managed-runtime-2026-10-12.md)，真实模型闭环仍未完成。

## 已实际解除的阻塞

用户在腾讯云完成登录，并明确确认在实例 `43.142.59.131` 新增 `TCP / 443 / 0.0.0.0/0 / 允许`。通过控制台提交后，页面显示 HTTPS 443 规则；原有 TCP 22、TCP 80 和 ICMP 三条仍在，合计四条。本次没有使用“一键放通”，没有重启服务器或修改 nginx、网站、数据库。

控制台截图保留本地 `rebuild/phase1/ui/cloud-443-enabled-2026-10-12.png`，含账号界面上下文，按精确文件模式 gitignore，不提交仓库。

在相同电脑且系统代理仍开启的情况下，直接 socket 校验证据从 443 超时变成连通：

| 验证 | 结果 | 边界 |
| --- | --- | --- |
| 公网 TCP 80 / 443 | 均连通 | 客户端绕过普通 HTTP 系统代理，未修改 Clash |
| 公网 HTTP 首页 | 200 | 原网站继续可用 |
| 公网 HTTPS 首页 | 200，系统证书链及主机名校验通过 | 没有关闭 TLS 校验或绕过安全提示 |
| 公网 HTTPS iO identity，无凭据 | 401 | 服务可达且仍要求鉴权 |
| 带既有凭据的资料往返 | 7 项检查通过 | 合成资料，非手机上传 |
| 电脑连接程序真实云端身份/inbox | 通过，只观察 | 无服务器写入、无任务领取或执行 |

因此此前入站 443 的硬阻塞已解除。不能将这个结论扩写为全部网络场景、手机同步或 Agent 运行已验收。

证据：

- `rebuild/phase1/server-network-diagnosis-2026-10-12.json`：02:40Z 直接 TCP/TLS、HTTP、主机监听与防火墙状态。
- `rebuild/phase1/server-public-live-verification-2026-10-12.json`：真实公网身份绑定、合成资料写入 201、同事件重放 200/同回执、精确读回及增量；新增合成资料名为 `live-check-*`，不删除历史资料。
- `rebuild/phase1/bridge-public-live-verification-2026-10-12.json`：真实身份及 scope 检查、只观察 inbox、不推进游标；人为仅对该客户端注入 fetch 失败时账本不变；恢复后真实读取成功；重新创建 bridge 对象后再读成功。未模拟真实断网，也没有杀死进程，不冒称进程崩溃恢复。

## 本轮代码改动

`tools/phase1/run-live-sync.ps1` 原来把令牌放进 `hdc ... aa ... --ps token` 参数。现改为读取私有凭据文件，校验期限及固定 HTTPS 目标，生成 gitignore 目录中的短暂 JSON，经 `hdc file send` 进入本 App 隔离实验私有目录，chmod 600 后原子改名；启动参数仅含 phase/run_id。令牌不进命令参数或输出，本地暂存始终清理；设备断线时设备暂存清理只能尽力执行。成功启动后的 `sync-target.json` 需实验结束后移除。

启动器仍拒绝已有 App 进程；不会自行 force-stop 可能正在采集的应用。四项使用假 HDC/合成凭据的检查通过：正常传递不泄漏 argv、已有进程拒绝、过期凭据拒绝、传输失败不启动且清理本地暂存。首次沙箱阻止 PowerShell 执行，提升执行权限后通过，没有修改系统执行策略。

`tools/phase1/verify-phone-live-sync.mjs` 为后续真机验收连接三份独立事实：native report 的 outbox 行、真实 `/events/{event_id}` 存储回执、电脑查询工具读回的原文/完整 body/同一来源修订。回执 ID、commit_seq、stored_at、对象及修订均需一致。它只读服务器，不上传或重放数据。四项合成检查通过，覆盖假成功、不同回执、不同原文/来源修订、native 失败不能被服务端已有数据“补成成功”。**目前没有运行成功的本轮 native report，此工具通过不代表真机通过。**

`tools/phase1/verify-live-bridge.mjs` 新增可重跑的真实公网只观察检查；`check-server-network.py` 增加公网 HTTPS 首页校验。两者不启动模型或改变网络设置。

## 真机及凭据状态

HDC 已确认手机在线，App 版本 0.1.46 / versionCode 10046，现存进程 PID 34409。没有强制停止该进程；用户是否正在录音/智记/字幕的事实确认尚待回复。

自动审批拒绝了“签发新的两小时资料读写凭据”，理由是可信用户授权未明确具体权限、接收方及期限。该操作未执行，没有新凭据产生。本轮仍可使用此前已验证的 `phone-harmony` 凭据（现有权限与期限不变），原 `phone-live` 已撤销不能复用。不存在因防火墙开放而开放匿名资料访问的改动。

收到无采集确认后：

1. 只结束自有 App 的空闲进程，确认 pidof 为空，再冷启动隔离 PersistenceLabAbility。使用 `-Credential rebuild/material-server/private/phone-harmony.json -Producer phone-harmony`，不启动日常录音/自动发现或上传用户内容。
2. 启动器输出 run_id 后，只收取 `.../p31-material-outbox-lab/live-<run_id>/transport-live-report.json` 到新文件，不覆盖原始失败报告。
3. 运行 `verify-phone-live-sync.mjs --report <新报告> --output <新核验>`，必须实际取得并匹配云端回执和原文。结束后移除实验目录中的固定 `sync-target.json`，不动任何录音/资料目录。
4. 通过后再测手机修订/删除、断网积压/重启恢复、日常自动发现与本地 sync_state 写回；不能用本次单条合成上传代替这些场景。

## 尚未完成

- 本轮手机真实公网同步尚未运行，AC-QUERY 的真实日常录音查询仍未达标。
- 电脑真实云端读取已通过，真实 Hermes 模型运行、原任务问答、真实崩溃恢复及结果返回未完成。
- 新后台仍是本机实现，未部署新多文件包、未签发生产 operations:read 管理凭据，不可声称已显示真实设备流量。既有 store-only 发布授权不扩展到这一包。
- 原音上传、凭据自动轮换、长时间功耗稳定性、官方基础功能全部对齐仍需独立验收。
- Excel 未改动；本轮用户未要求更新快照。
