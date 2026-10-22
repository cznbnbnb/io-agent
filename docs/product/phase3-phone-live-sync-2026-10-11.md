# P31 真机联网同步：实现完成、被云防火墙 443 拦截

日期：2026-10-12（承接 2026-10-11 深夜部署）。承接[服务器部署记录](./phase1-server-reuse-2026-10-11.md)与[P40 队列记录](./phase4-message-queue-2026-10-11.md)。此文件记录分级结果与阻塞证据，不替代 DEVELOPMENT-PLAN 或 PRD 验收。

**后续状态（2026-10-12 10:45）**：用户授权后已通过腾讯云控制台添加 TCP 443，公网证书/首页/API 鉴权、合成资料往返及电脑只观察连接已通过。以下是原始失败记录，不删除历史证据；“控制台无法代做”和“443 阻塞”不再是当前状态。手机新一轮冷启动实验仍待无采集事实确认，详见[公网恢复记录](./phase3-public-connectivity-2026-10-12.md)。启动器已改为私有文件传令牌，不再通过 aa 参数。

本批新增设备侧真机联网实验、传输诊断字段与签名工具修复；**真机真实联网同步未成功**，原因不在应用或服务，而在云防火墙未放开 443。没有读取或上传任何用户内容（仅合成资料）。

## 1. 代码完成

| 位置 | 内容 |
| --- | --- |
| `PersistenceLab.transport-live` | 读取操作者下发的目标（优先私有文件 `sync-target.json`，否则把 `aa` 参数先落盘再使用），校验 HTTPS/身份分区，调用 `MaterialSyncTransport.pump`，**只记录服务端真实回执**；无回执即失败，绝不写合成回执 |
| `PersistenceLabAbility` | live 阶段走异步路径，报告写入实验目录供 hdc 收取 |
| `MaterialSyncTransport` | 新增受限诊断：`lastIdentityStatus`、`lastErrorCode`（只保留状态码/错误类别，不含 URL、令牌、正文） |
| `tools/phase1/run-live-sync.ps1` | 启动器：令牌只从私有文件读入，不回显；记录 run_id/pid 到 gitignore 的 `device-private/` |
| `rebuild/phase1/parse-json5.mjs` + `sign-candidate.ps1` | 修复签名：DevEco 的 `build-profile.json5` 是 JSON5，且 PowerShell 5.1 会把含中文的仓库路径以 ANSI 传给 node 导致解析脚本找不到；改为复制解析脚本到 ASCII 临时目录后用 DevEco 自带 json5 解析。脚本保持 ASCII-only（PS 5.1 对无 BOM 的 UTF-8 会读错，中文注释曾直接导致语句损坏） |

## 2. 验证分级

| 层级 | 结果 | 范围 |
| --- | --- | --- |
| 本地模拟回归 | 通过 | 传输套件 12 项（含新增诊断字段）、真机阶段 3 项（真实回执/身份不符/参数落盘）、`verify.ps1` 全量通过；HTTP 为桩，无真实网络 |
| 鸿蒙原生构建与签名 | 通过 | 0.1.46；`entry-default-signed.hap` 447652317 字节，SHA256 `31CDB72A8F07D68DCB30684C04F2F3C82A1791CE28071DCBFE8AB2B8B8C7C210` |
| 覆盖安装 | 通过 | 手机安装 0.1.46（versionCode 10046），既有资料保留 |
| 真机真实网络 | **未通过（外部阻塞）** | 两次运行均为 `IDENTITY_UNAVAILABLE`，未发出任何资料 |

真机报告：`rebuild/phase1/device-p31-live-sync.json`（含诊断字段）与 `device-p31-live-sync-attempt1.json`（首次）。两次运行的目标均为 `https://cznbnb.cn/io-api/v1`，生产者为一次性凭据 `phone-live`。

## 3. 阻塞证据（TCP 443 被云防火墙拦截）

| 观察 | 结果 |
| --- | --- |
| 手机 ICMP 到 43.142.59.131 | 通，42–57 ms |
| 手机 `openssl s_client cznbnb.cn:443` | `connect: errno=110`（超时） |
| 手机对照 `www.baidu.com:443` | `CONNECTION ESTABLISHED`（TLSv1.2） |
| 手机对照 `cznbnb.cn:80` | TCP 已连接（明文 HTTP） |
| 本机端口探测 43.142.59.131 | 22/80 开放；443/8443/3000/8080 超时 |
| 独立外部检查（Qualys SSL Labs） | `cznbnb.cn:443` → `READY`，`Unable to connect to the server`，无证书链、无协议 |
| 服务器本机回环 TLS 往返 | 7/7 通过（未认证 401、身份绑定、写入 201、重放 200、读回、增量） |

汇总见 [server-443-firewall-evidence.json](../../rebuild/phase1/server-443-firewall-evidence.json)。结论：入站 TCP 443 被拦截，服务本身工作正常；这与源 IP 或本机网络无关（外部检查同样失败）。

## 4. 解除阻塞需要的一步（用户操作）

腾讯云轻量应用服务器控制台 → 该实例 → **防火墙** → 添加规则：**TCP / 443 / 允许 / 0.0.0.0/0**（保留现有 80、22 规则）。这一步需要控制台登录或云 API 凭据，本机没有可用凭据，因此无法代做。

开放后我会：重新签发一次性凭据 → 重跑 `tools/phase1/run-live-sync.ps1` → 预期 outbox 行进入 `server_stored` 并带服务端 `receipt_id`/`commit_seq` → 再从服务器侧按 `material_id` 与原文核对，形成真机端到端证据。

## 5. 凭据与隐私

真机测试用一次性凭据 `phone-live`（2 小时、仅 `materials:write/read`）**已撤销**；设备 hilog 中未检索到令牌前缀（`token_prefix_present=0`）。本轮只写入合成资料 `真机联网自检：合成资料，不是用户内容`，且因网络被拦截，实际未到达服务器。

## 6. 仍未完成

- 真机到服务器真实同步（本轮阻塞项）、原音上传、凭据自动轮换、长时间稳定性均未验证。
- P41 电脑连接程序仍只有草稿（`rebuild/agent-bridge/client.mjs`，未提交完整组件），P42–P44 未开始；AC-QUERY/AC-ASK/AC-OFF 不据此关闭。
