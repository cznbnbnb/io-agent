# 长资料传输 v1

2026-10-24 源码实现；尚未部署或装机。`GET /v1/identity` 的 `capabilities` 包含 `material_transfer_v1` 才启用。事件结构、资料 ID、修订号和存储回执不变。

## 上传

普通事件仍走 `/v1/material-events`，单次请求仍上限 256 KiB。较大的完整事件按 UTF-8 原始字节拆成 128 KiB 块，不截断正文，也不创建多份资料。

1. `POST /v1/material-uploads`，JSON 为 `{event_id, bytes, sha256}`。SHA-256 是持久队列中完整事件字节的哈希，同时用作 `upload_id`。
2. 返回 `{upload_id, bytes, part_bytes, parts, received, expires_at, receipt}`；只发送未收到的索引。
3. `POST /v1/material-uploads/<upload_id>/parts/<index>`，JSON 为 `{data, sha256}`。`data` 为标准 Base64，哈希属于这一块。重发同块幂等，改写已收到块返回冲突。
4. `POST /v1/material-uploads/<upload_id>/finalize`，请求体必须为 `{}`。完整字节校验通过后，进入普通事件相同的 schema、producer、有效期、CAS、幂等事务，返回原 `server_stored` 回执。

块未齐时不产生资料、修订或 changes 条目。未知响应仍先按原 `event_id` 对账。重启、丢失块回复或丢失 finalize 回复均沿用原事件；不换 ID 试投。提交和清理之间崩溃可重试原事务取得同一回执。

所有上传入口要求 `materials:write`，临时块按 owner 与 producer 双重隔离。每份最多 8 MiB；每个 owner 同时最多 16 份未完成上传、预留总量最多 64 MiB；临时块 24 小时后过期，下一次 begin 清理。过期或撤销凭据不能续传。这里的临时块清理不删除已提交资料。

## 未确认旧发送的撤销

`material_cancel_v1` 是单独的服务能力。客户端每次先核对 identity，再 `POST /v1/material-cancellations`，请求仅含 `{event_id, idempotency_key, material_id, revision, payload_sha256, expires_at}`。哈希属于按既有 canonical JSON 编码的完整原事件；手机持久发送队列使用此编码。这里撤销的是尚未提交的发送，不是删除资料。

同一 SQLite 写事务与正常提交竞争：原事件已存储时，核对事件、幂等键、完整哈希和资料修订后返回原回执；未提交时，在原有 events 表中保留不可覆盖的撤销证明，返回 `state=cancelled`、原意图、owner/producer/server 和确认时间。没有新的资料修订或 changes 条目。证明丢失时可用原 GET events 恢复，重复撤销幂等。

凭据必须具有原 producer 的 `materials:write`。手机逐项核对证明后，才允许以新 event ID/幂等键替换同一待上传修订，保留旧哈希和证明。第 N 修订仍要求已确认的 N−1 基准；来源日志先保存新意图，再重放到队列。旧引导日志重放只命中别名，不复活旧正文。网络结果未知或服务不支持时保持原状态。

撤销记录使用 `cancelled:` 非哈希摘要占住原 events 唯一键。新版返回 `MATERIAL_EVENT_CANCELLED`；旧服务即使不识别撤销协议，也会因幂等摘要或 event ID 冲突拒绝迟到旧事件。对应未提交分块在同一事务清除，释放预留空间；此后该 event ID 不可重新开始传输。已入库资料从不被这一接口删除。2026-10-24 已在 Node 22 上用线上只读代码副本及独立合成数据库，通过四进程的升级→代码回退→再升级演练：旧服务仍保留新全文并拒绝已撤销旧事件。未切换线上服务或访问正式数据库，实际生产激活仍须独立预检、备份与健康核对。

## 完整回读

支持该能力的电脑客户端向 materials、changes、详情请求传入 `content=reference`。超过 256 KiB 的条目变为 `{content_ref:{material_id, revision, bytes, sha256, part_bytes, parts}}`。再用 `GET /v1/material-content/<material_id>?revision=N&index=N` 拉取各块，校验每块和整体哈希、严格 UTF-8、JSON 及原 schema 后才向调用方返回完整原条目和来源引用。

每块重新检查 owner、查询权限和资料当前删除状态。读取中删除会中止本次回读；不会展示已收到的部分旧正文。单页展开总量最多 32 MiB，超出明确报错，调用方须减小分页大小。旧客户端遇到无法放进既有 1 MiB 响应的大条目时收到 `MATERIAL_CONTENT_REQUIRED`，不会静默得到空页。新增 `content` 筛选绑定游标，旧游标切换模式时需要重置。

## 手机容量与交付边界

当前手机完整事件上限 4 MiB；原厂单条原始响应上限保持 1 MiB。任何容量超限保留原资料并提示，不截断。后续源码已增加已确认历史收缩和 16 MiB 活跃载荷预算，见[自动同步契约](material-auto-sync.md)；仍未装机，不能把本批称为正式自动同步已完成。

新增两张临时 SQLite 表，原资料/队列事务未迁移。正式发布包必须带 `material-transfer.mjs`，旧的历史打包清单不足以部署当前完整服务。手机写入超过旧版上限的事件后，dev72 回退会保守拒绝读取该日志，不能靠回退包清除状态；装机与真实资料上传前须完成容量兼容处理和部署演练。

合成验证：最初 Node 22.23.2 上 17 项分块/查询测试；本次加入撤销后共 20 项通过；Java 三进程分别模拟丢块回执、丢提交回执、重启对账，再上传增长后的同一资料修订并完整回读。未签发正式资料凭据，未上传真实智记。

## 发布准备

`tools/phase1/rehearse-material-transfer-release.mjs` 只接收两个代码目录，自己创建独立临时数据库和合成凭据，四个进程依次验证旧版写入、新版分块/撤销、旧代码回退、再次升级与新修订。完成后撤销合成凭据、删除临时资料，记录全部运行文件/契约哈希。

`tools/phase1/package-material-transfer-release.py` 根据这份演练报告与明确 Git 提交生成 17 份文件的源码审阅包，补齐旧清单遗漏的 `devices.mjs`、`material-transfer.mjs`。包内不含数据库、凭据、node_modules 或手机资料；缺模块、哈希变化、演练失败都会在输出前拒绝。该包标为 `activation_verified=false`，历史发布控制器不接受此新 profile，不能直接当作已发布版本。准备阶段未改变服务和手机；实际激活结果见下文。[准备证据](../../rebuild/android-app/r4-server-release-preparation-2026-10-24.json)。

2026-10-24 实际发布：新发布器复用原代码切换控制器，先比对线上基线并保存服务端 SQLite 备份（不回灌），再启用已演练的 17 文件来源包；源码、服务、HTTPS 与数据库 inode 核验通过。原审阅包仍保持 `activation_verified=false`，独立[发布证据](../../rebuild/android-app/r4-server-activation-2026-10-24.json)记录实际激活结果；正式材料联调仍待限期授权。
