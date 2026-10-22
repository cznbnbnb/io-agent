# iO 服务端修复发布包（2026-10-12）

## 当前状态

**用户于 2026-10-12 明确授权后，已完成单文件发布与独立 iO 服务重启。** 线上五文件最终哈希与本地已验证版本一致，服务 active、health 正常、经证书校验的 HTTPS 回环 identity 返回预期 401。未更改既有网站、nginx、数据库结构或用户资料。此前自动审批因生产替换/重启授权不明确而拒绝执行；本次用户明确授权已解决该条件。

发布前线上 store.mjs：`37b28bf5348e2c7a30b47edce04ec0807a99cea3dfa144ac57e72b8cffb4850d`。

当前线上 store.mjs：`58df925b679aaa6d2209e8687168e6fc56e1752ef9546d75abf66646a471123b`，修复来自 `689491c`，与[31 项服务端回归](../../rebuild/material-server/verification/result.json)的已验证源码哈希一致。

实际备份：`/opt/turboio/rebuild/material-server/.store-backup-b1504fe4d1bf4c21b705300a9ec32195.mjs`。部署报告：[实际发布记录](../../rebuild/phase1/server-store-deploy-2026-10-12.json)。这次未触发回退，自动回退分支尚无生产故障演练证据。

首次执行在备份上传时因 SSH 账号 UID 1000 无权写 root:root 755 的目标目录失败，尚未替换或重启。核查确认该账号已有非交互 sudo 后，脚本改用固定路径的提权上传、原子替换与独立服务重启，未放宽目录权限。源码通过 SSH stdin 传输，不放入 argv；原 UID/GID/mode 保留。失败记录：[首次权限失败](../../rebuild/phase1/server-store-deploy-permission-failure-2026-10-12.json)。

## 修复内容与范围

1. 新建任务必须从 queued 开始，拒绝客户端伪称已执行或完成。
2. 任务已取消/请求取消、终止或执行不明时，拒绝迟到答案继续推进任务。
3. 回执查询按 subject_kind 与 ID 隔离，防止同名 task/request 混入；保留显式历史 revision 的事实。

发布仅替换 `/opt/turboio/rebuild/material-server/store.mjs`，重启 `turboio-material.service`。不涉及数据库结构迁移、用户资料清理、nginx、Node20、MySQL或既有网站。短暂中断限 iO API；现有 outbox 仍需按既有重试恢复。

## 已准备的保护

[发布脚本](../../tools/phase1/deploy-reviewed-store.py) 默认只读预检，`--apply` 才修改：

- 校验本地回归通过及五个服务文件哈希；四个非 store 文件必须保持旧基线。
- 连接用户既有 SSH helper 的指定主机，凭据留在 helper 内，不进入参数/输出/仓库。
- 线上五文件必须等于已审核旧基线或当前版本；其他状态拒绝覆盖。
- 原源码保存为带 UUID 的 `.store-backup-*.mjs`；上传 staging 后核对哈希和 Node22 语法。
- 最后再次核对旧哈希，保留 UID/GID/mode，原子替换并 fsync；只重启独立 iO 服务。
- 核对服务 active、health 与经 TLS 校验的回环 identity 401，以及五个最终源码哈希。
- 后验失败时，仅在线上 store 仍为本脚本发布版本的条件下恢复旧源码并重启；不覆盖另一部署者的新改动。SSH 回执丢失时先检查实际源码，无法确认则报告 unknown，不宣称未修改。

只读预检结果：[预检记录](../../rebuild/phase1/server-store-preflight-2026-10-12.json)。截至预检，服务 active、health 正常、TLS 回环 401，线上文件与审计旧基线一致。公网 443 连通性没有因这次预检改变。

## 执行入口

当前机器 Python 的 `.pth` 损坏，脚本以 `-S` 启动并显式使用现有 paramiko 目录，不修改 Python 安装：

```powershell
python -S -X utf8 tools/phase1/deploy-reviewed-store.py          # 只读
python -S -X utf8 tools/phase1/deploy-reviewed-store.py --apply  # 仅获本次明确授权后
```

报告 `rebuild/phase1/server-store-deploy-2026-10-12.json` 已记录成功部署和实际备份路径。健康/哈希检查是部署验证，不等于真实手机、Agent 或公网端到端通过。公网 443 连通性仍待核验及解决，不据此断定唯一原因是腾讯云防火墙规则。
