# 资料服务部署包（2026-10-11 深夜已在本机生产主机实测通过）

面向已登记的腾讯云主机（Ubuntu 24.04 + Nginx，现有站点 `cznbnb.cn`，见[接入边界](../../../docs/product/phase1-server-reuse-2026-10-11.md)）。目标：为雷鸟资料/队列服务建立**独立**进程、数据库与备份目录，只新增一个 Nginx 位置，不改动现有网站代码、Cookie、tRPC 路由和业务表。

本目录是模板与只读盘点脚本；**实测结果与踩坑见文末“首次实测记录”**。手机传输组件硬性要求 `https://<host>/v1`，TLS 已通过 certbot 配置完成。

## 0. 上线前必须由用户确认（首次已由用户授权）

| 事项 | 状态 |
| --- | --- |
| 授权 | 用户确认该主机可用于本项目 |
| 访问 | 通过 `D:\Project\Kimi_Agent_手持娱乐值网站\app\.deploy\ssh.py`（paramiko，密码留在该私有文件，不进本仓库） |
| TLS | certbot 签发 `cznbnb.cn`（到期 2027-01-09，自动续期） |
| 运行时 | `/opt/turboio/node22`（v22.23.2）与站点 Node20 并存，**不替换**站点运行时 |
| 端口 | 服务 3401（回环），nginx 只新增位置 |
| 回退 | 停新服务 + 恢复 nginx 备份 + 删独立目录 |

## 1. 只读盘点（不改任何配置）

```bash
sudo bash preflight.sh | tee /tmp/io-preflight-$(date +%F).txt
```

脚本只读取 OS、Node 版本、监听端口、Nginx 片段、证书有效期、内存/磁盘、pm2 列表与目标端口占用；不安装、不重启、不写入站内文件。输出含主机信息，先在本地查看，不要直接公开。

- 若 443 未监听或证书缺失：先完成 TLS（另按用户选择的方式），**不要**为了让手机连通而加明文端口或让传输组件降级。
- 若磁盘/内存紧张或备份缺失：先与用户确认再决定是否同机部署。

## 2. 部署步骤（模板值需按盘点结果替换）

```bash
# 2.1 独立运行时与目录（不碰站点 /usr/bin/node 与 pm2 进程 ev）
sudo useradd --system --home /var/lib/turboio-material --shell /usr/sbin/nologin turboio-material
sudo install -d -m 0700 -o root -g root /opt/turboio
sudo install -d -m 0700 -o turboio-material -g turboio-material /var/lib/turboio-material
# Node 22.23.2 解压到 /opt/turboio/node22（与站点 Node20 并存，PATH 不改）

# 2.2 部署源码（仅服务目录）与锁定依赖
sudo install -d -m 0755 /opt/turboio/material-server
sudo cp -r <仓库>/rebuild/material-server/{cli.mjs,http.mjs,json.mjs,store.mjs,validation.mjs,package.json,package-lock.json} /opt/turboio/material-server/
cd /opt/turboio/material-server && /opt/turboio/node22/bin/npm ci --ignore-scripts --no-audit --no-fund

# 2.3 签发短期、按主体/作用域隔离的凭据（原值只写私有文件）
/opt/turboio/node22/bin/node cli.mjs mint --db /var/lib/turboio-material/materials.sqlite \
  --owner <owner-id> --producer phone-<设备名> --scopes materials:write,materials:read,tasks:write,tasks:read,requests:read,answers:write,messages:receive,receipts:phone \
  --out /var/lib/turboio-material/phone-<设备名>.json
/opt/turboio/node22/bin/node cli.mjs mint --db /var/lib/turboio-material/materials.sqlite \
  --owner <owner-id> --producer pc-<电脑名> --scopes materials:read,changes:read,tasks:read,tasks:update,requests:write,messages:receive,messages:write,receipts:agent \
  --out /var/lib/turboio-material/pc-<电脑名>.json

# 2.4 独立服务（模板：turboio-material.service）
sudo install -m 0644 turboio-material.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now turboio-material
systemctl status turboio-material --no-pager

# 2.5 只新增一个 Nginx 位置（模板：nginx-io-api.conf），放进现有站点的 443 server{}
sudo nginx -t && sudo systemctl reload nginx
```

## 3. 上线验证（顺序不可省）

1. `curl -sS https://cznbnb.cn/io-api/v1/identity` 无凭据应 401；带手机凭据应返回与登记一致的 `owner_id`/`producer_id`/`server_id`/scopes。
2. 用查询工具读一次真实（或合成）资料：`node query/cli.mjs search --config <本机配置> --keyword <合成词>`，确认 HTTPS 路径、游标与来源引用可用。
3. 用手机合成诊断走一次同步（P31 路径），确认手机侧收到 `server_stored` 回执；再走一次问答（P40 路径）确认答案与回执阶梯。
4. 记录 `systemctl status`、`journalctl -u turboio-material`（不含用户正文）、`result.json` 与服务端测试结果。
5. 未通过第 1–3 步前，不宣称 HTTPS 端到端、手机同步或 P40–P44 完成。

## 4. 回退

```bash
sudo systemctl disable --now turboio-material      # 停新服务
sudo rm -f /etc/systemd/system/turboio-material.service && sudo systemctl daemon-reload
# 从站点 443 server{} 移除 include，nginx -t && systemctl reload nginx
sudo rm -rf /opt/turboio /var/lib/turboio-material # 仅独立目录，确认无其他依赖后执行
```

回退不影响现有网站进程 `ev`、其 Node20、MySQL 与站点文件。删除前先备份 `/var/lib/turboio-material`（含摘要凭据与资料库），并按[服务 README](../README.md)的恢复边界处理。

## 5. 明确不做

- 不在站点 Node20 下运行本服务（`node:sqlite` 版本不符），不升级站点运行时。
- 不把设备令牌写进 App 包、源码、日志或 Nginx 配置；不使用查询参数传凭据。
- 不为“先跑通”放开明文 HTTP 或跳过 `nginx -t`。
- 不在未获批的情况下改动现有站点的任何 server 块、证书或数据库。

## 6. 首次实测记录（2026-10-11 深夜）

落点：代码 `/opt/turboio/rebuild/material-server`、Schema `/opt/turboio/docs/contracts`、运行时 `/opt/turboio/node22`、数据 `/var/lib/turboio-material`(0700)、单元 `turboio-material.service`、入口 `https://cznbnb.cn/io-api/v1/`。证据 [live-verification](../../../rebuild/phase1/server-live-verification.json)、[deployment-facts](../../../rebuild/phase1/server-deployment-facts.json)。

按本目录模板部署时踩到四处，模板已按实测修正：

1. **校验 Schema 必须一起部署**：`validation.mjs` 按 `../../docs/contracts/` 解析，缺文件时启动报 `ENOENT`。因此代码放在 `/opt/turboio/rebuild/material-server`、Schema 放在 `/opt/turboio/docs/contracts`，保持仓库相对布局。
2. **`/opt/turboio` 不可 0700**：服务用户穿不过去时 systemd 报 `status=200/CHDIR`。实测用 `0755` + 代码目录 `a+rX`。
3. **nginx 1.24 不支持 `http2 on;`**：写 `listen 443 ssl http2;`（1.25+ 才支持新写法）。首次 `nginx -t` 失败即自动回滚到备份配置。
4. **`server_name _` 让 `certbot --nginx` 无法自动安装**：证书能签发（HTTP-01 通过），但 installer 找不到匹配 server 块。实测改为 certbot 只签发 + 手工写入 443 与证书路径，`nginx -t` 通过后 reload。

首次部署时：本机（开发电脑）出网对 443 被阻断，线上 HTTPS 往返只能在服务器本机验证——临时把 `cznbnb.cn` 指到 `127.0.0.1`（先备份 `/etc/hosts`，用完恢复），再用 `tools/phase1/verify-live-service.mjs` 跑 7 项核对。核验写入的 `probe-*`／`live-check-*` 是合成自检资料。这是首次部署的历史状态。

2026-10-12 更新：云防火墙 TCP 443 已按用户授权放通，开发电脑公网 HTTPS 已可达，手机合成资料真实上传及离线恢复亦已有单项证据。后续多文件发布使用[源代码评审包与回退演练](../../../docs/product/phase4-server-release-package-2026-10-12.md)；不重新执行上面的首次建用户、签发凭据或删除独立目录模板。

2026-10-14 当前r3已真实激活：源码绑定 `a1cbf1900cc0513a98b9f106f2b6462598bd8f5b`，生产代码与Schema匹配冻结包，保留完整r2代码回退目录。真实公网 HTTPS 与实际查询CLI合成后验17/17通过，见[发布记录](../../../docs/product/phase2-speaker-server-release-preparation-2026-10-13.md)与[合成后验](../../phase1/cloud-speaker-r3-20261014-0104-speaker-verification.json)。这不证明手机实际1.2同步、真实用户资料查询、生产回退或长期稳定性；本目录首次部署/删除模板不能作为日常版本更新步骤。
