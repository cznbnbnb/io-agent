# 腾讯云现有服务器接入边界

2026-10-11，用户指定复用 `D:\Project\Kimi_Agent_手持娱乐值网站\app` 所用腾讯云服务器，并提供已备案域名 http://cznbnb.cn/。本轮只读检查该项目及公网 HEAD；未运行部署、数据库命令或读取凭据。

## 核对结果

- 已读取该项目 AGENTS.md。源码是 React/Vite 前端、Hono/tRPC 后端、MySQL/Drizzle；api/boot.ts 将 `/api/trpc/*` 交给 tRPC，其余 `/api/*` 返回404。api/router.ts 当前挂载 ping、auth、entertainment、feedback，没有本项目三组接口。
- 部署文档登记 Ubuntu、Node20、Nginx→本机3000、pm2进程ev；本地 nginx-ev.conf 只有80端口反代，上传上限50MB。这是本地配置证据，未登录检查线上实际配置或资源余量。
- 现有网站认证是 `ev_session` Cookie 和30天 sessions 表；不能直接作为手机/电脑的设备级Bearer身份或各作用域授权。
- 本机受限网络无法访问后，获准的只读公网检查得到 HTTP HEAD 200，Server为nginx/1.24.0 (Ubuntu)；HTTPS连接未建立。不能据此确定是证书、监听、网络还是TLS配置原因，更不能宣称HTTPS/WSS可用。网页检索工具同样无法读取该站点。原始状态见 `rebuild/phase1/server-public-reachability.json`。

## P30–P32 候选部署方案（尚未部署）

优先共用服务器主机和Nginx入口，为雷鸟资料服务建立独立进程、数据库/账号与备份目录，避免修改现有娱乐值业务表。候选公网前缀 `/io-api/v1/` 反代至独立本机端口；它映射P14的逻辑 `/v1/*`，不改变事件Schema或回执含义，具体端口部署前核对占用。

先补齐域名TLS并验证HTTPS；连接程序需要WS时再验证Nginx Upgrade与心跳/断线补拉。上线前核对主机磁盘、内存、现有备份、数据库事务能力及回退方法。原音使用独立上传/校验接口，不经过现有tRPC 50MB整包请求。手机和连接程序发短期、可撤销、按主体/作用域隔离的令牌，不能把网站Cookie或服务器账号嵌入App。

最初网页仅需认证后的资料/同步与消息状态诊断，可在P30测试服务稳定后设计；本轮无需再造娱乐值网站，也未提前上传用户录音。备案情况按用户提供记录，未独立核验。上线仍按P14分别证明存储、手机接收、眼镜显示、用户回答、Agent接收及任务完成。

依赖：P20–P22可靠本地资料、P14事务/去重/修订契约、测试服务与隔离数据库、TLS及部署回退。服务器环境已定位；凭据、线上配置与正式端到端尚未核验，只阻塞其对应部署工作。

## 二次只读探测（2026-10-11 晚，仍未部署）

同一域名再探一次，结果见 `rebuild/phase1/server-public-reachability-round2.json`：`http://cznbnb.cn/` 仍为 200（nginx/1.24.0 Ubuntu），`https://cznbnb.cn/` 与 `https://cznbnb.cn/io-api/v1/identity` 均在 8 秒内未完成连接（TimeoutError）。本轮结果**不能**判断服务器 443 的真实状态：既可能是本机出网对 443 受限，也可能是服务端未监听或中间设备丢包；与首次“SSL连接无法建立”的差异同样可能来自本地网络，而不是服务器变化。要确定 TLS 现状，只能在主机上（`ss -ltn`、`nginx -T`、证书有效期）或换一个网络核验，`deploy/preflight.sh` 已包含这些只读检查。

可评审的部署材料已备好但**一步未执行**：`rebuild/material-server/deploy/`（只读盘点脚本、systemd 独立单元、只新增一个位置的 nginx 片段、上线验证顺序与回退步骤）。真实部署仍取决于用户确认共享主机授权、SSH 访问、TLS 证书现状与 Node22 并存方案。

## 已部署（2026-10-11 深夜，用户授权使用该主机）

用户明确“服务器就是拿来干这些事的”，本批据此完成首次真实部署。部署只新增独立进程/目录/位置，站点业务代码、数据库、Cookie 与 pm2 进程 `ev` 未改动。

**实际落点**

| 项 | 值 |
| --- | --- |
| 服务目录 | `/opt/turboio/rebuild/material-server`（代码）＋`/opt/turboio/docs/contracts`（校验用 JSON Schema） |
| 运行时 | `/opt/turboio/node22`（v22.23.2），与站点 `/usr/local/bin/node`(v20.19.5) 并存 |
| 数据 | `/var/lib/turboio-material`（0700，系统用户 `turboio-material`），`materials.sqlite`(0600) |
| 服务 | systemd `turboio-material.service`（`ProtectSystem=strict` 等加固，仅回环 3401） |
| 入口 | `https://cznbnb.cn/io-api/v1/` → nginx → `127.0.0.1:3401/v1/`；明文访问 308 升级 HTTPS |
| 凭据 | owner `turboio-user`；`phone-harmony`／`pc-desktop`／`pc-query`，24 小时上限、文件 0600 |

**站点配置的唯一改动**（`/etc/nginx/sites-enabled/ev`，改动前备份 `/root/nginx-ev.backup-2026-10-11-2359.conf`）：新增 `listen 443 ssl http2`、`server_name cznbnb.cn _`、证书路径与 `location /io-api/v1/`；原有 `location /` 反代 3000 一字未改。`nginx -t` 通过后才 reload。TLS 由 `certbot` 签发（`CN=cznbnb.cn`，到期 2027-01-09，已装自动续期定时器）；`certbot --nginx` 因站点 `server_name _` 无法自动安装，改为手工写入 443。

**验证（真实 HTTPS，全部合成数据）**

- 本机外网 80：站点 200，`/io-api/v1/identity` 返回 308 → HTTPS。本机出网对 443 被阻断，**无法从这台电脑直连核验**。
- 服务器本机（临时 `/etc/hosts` 指向 127.0.0.1，用后立即恢复）：7/7 通过——未认证 401、凭据身份绑定、合成资料写入 201 且回执 `server_stored`、同事件重发 200 且值与 `receipt_id` 一致、按关键词精确读回原文与来源引用、增量游标可见该修订。
- 部署代码 SHA256 与仓库当前文件逐项一致。
- 证据：[live-verification](../../rebuild/phase1/server-live-verification.json)、[deployment-facts](../../rebuild/phase1/server-deployment-facts.json)、[公网探测 round3](../../rebuild/phase1/server-public-reachability-round3.json)；核验脚本 [verify-live-service.mjs](../../tools/phase1/verify-live-service.mjs)。

**仍未验证**：手机→服务器真实同步、电脑连接程序投递、原音上传、凭据轮换（当前 24 小时手工重签）、长时间稳定性、App 与眼镜显示。数据库中的 `probe-*`／`live-check-*` 是自检合成资料，不是用户对话。

**2026-10-12 补充（入站 443 被云防火墙拦截）**：真机同步首次尝试失败，原因是入站 TCP 443 未在轻量应用服务器防火墙放行——手机 ICMP 通但 `openssl` 连接超时、`www.baidu.com:443` 对照成功、本机端口探测 443/8443/3000/8080 全部超时、Qualys SSL Labs 从公网同样无法连接，而服务器本机回环 TLS 往返 7/7 通过。需在控制台防火墙新增“TCP 443 允许 0.0.0.0/0”后方可继续；详见[真机同步记录](./phase3-phone-live-sync-2026-10-11.md)。

**回退**：`sudo systemctl disable --now turboio-material` → 恢复 `/root/nginx-ev.backup-2026-10-11-2359.conf` 并 `nginx -t && systemctl reload nginx` → 视需要删除 `/opt/turboio` 与 `/var/lib/turboio-material`；证书可 `certbot delete --cert-name cznbnb.cn`。回退不影响站点进程 `ev`、MySQL 与站点文件。
