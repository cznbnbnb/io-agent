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

## 完整回读

支持该能力的电脑客户端向 materials、changes、详情请求传入 `content=reference`。超过 256 KiB 的条目变为 `{content_ref:{material_id, revision, bytes, sha256, part_bytes, parts}}`。再用 `GET /v1/material-content/<material_id>?revision=N&index=N` 拉取各块，校验每块和整体哈希、严格 UTF-8、JSON 及原 schema 后才向调用方返回完整原条目和来源引用。

每块重新检查 owner、查询权限和资料当前删除状态。读取中删除会中止本次回读；不会展示已收到的部分旧正文。单页展开总量最多 32 MiB，超出明确报错，调用方须减小分页大小。旧客户端遇到无法放进既有 1 MiB 响应的大条目时收到 `MATERIAL_CONTENT_REQUIRED`，不会静默得到空页。新增 `content` 筛选绑定游标，旧游标切换模式时需要重置。

## 手机容量与交付边界

当前手机完整事件上限 4 MiB；原厂单条原始响应上限保持 1 MiB。任何容量超限保留原资料并提示，不截断。旧手机队列与修订日志的聚合容量仍为 4 MiB，后续自动增量批次须处理已确认历史的存储占用，不能把本批称为自动同步已完成。

新增两张临时 SQLite 表，原资料/队列事务未迁移。正式发布包必须带 `material-transfer.mjs`，旧的历史打包清单不足以部署当前完整服务。手机写入超过旧版上限的事件后，dev72 回退会保守拒绝读取该日志，不能靠回退包清除状态；装机与真实资料上传前须完成容量兼容处理和部署演练。

合成验证：Node 22.23.2 上 17 项分块/查询测试；Java 三进程分别模拟丢块回执、丢提交回执、重启对账，再上传增长后的同一资料修订并完整回读。未签发正式资料凭据，未上传真实智记。
