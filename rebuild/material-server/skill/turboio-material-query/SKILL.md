---
name: turboio-material-query
description: 查询本机“雷鸟 iO”资料服务里已同步的日常对话资料：按时间/关键词/说话人检索、取不可变原文修订、拉取增量变化并给出来源引用。需要回忆、引用、核对或增量跟踪用户日常记录时使用；不用于写入资料、部署服务器、上传原音或查询办公消息。
metadata:
  short-description: 查询已同步的日常对话资料
---

# 雷鸟 iO 日常资料查询

用真实查询结果回答，不用记忆或推测补全。工具是只读的：不改资料、不建任务、不上传原音、不启动别的 Agent。

## 先确认入口

1. 找到项目里的查询工具：`<repo>/rebuild/material-server/query/cli.mjs`。若当前工作区没有它，向用户确认仓库位置，不要在别处新建或改写服务。
2. 找到查询配置（含服务地址、owner/producer/server 标识和凭据文件路径）。配置文件不存在或凭据过期时，明确说明缺什么（需要管理员 `mint` 只读凭据），**不要**改用其他凭据、把令牌写进命令行或伪造示例数据。
3. 只查用户要求范围；服务器只需要回环或 HTTPS 地址，遇到 `HTTPS_REQUIRED` 不改降级方案。

## 调用

```powershell
node <repo>/rebuild/material-server/query/cli.mjs search  --config <配置> [--from <RFC3339>] [--to <RFC3339>] [--keyword <文字>] [--speaker <ID>] [--limit 1-50] [--cursor <游标>]
node <repo>/rebuild/material-server/query/cli.mjs get     --config <配置> --material-id <ID> [--revision <正整数>]
node <repo>/rebuild/material-server/query/cli.mjs changes --config <配置> [--limit 1-50] [--cursor <游标>]
```

- 时间范围、关键词定位、说话人、取原文用 `search`；某条资料的完整正文或某次历史修订用 `get`；"上次之后有什么新变化"用 `changes`，把返回的 `next_cursor` 存下来下次传入。
- 分页与增量都要用返回的 `next_cursor` 继续，不要自己拼游标，也不要在报 `CURSOR_RESET_REQUIRED` 后跳到最新继续增量：必须重新查询并重建检查点。
- 输出是单行 JSON；错误走 stderr 并以 `{"ok":false,"error":{...}}` 说明原因。

## 读结果

- 原文在 `items[].body.full_text.text` 与 `body.utterances[]`；引用时给出 `source_ref`（`material_id`/`revision`/`text_revision`/`utterance_id`/`start_ms`/`end_ms`）。说话人只按 `speaker_id`/`speaker_basis` 现状转述，不推断实名。
- 资料 1.2 的 `body.speakers` 与命中 `speaker` 给出显示 label、label_basis 和 is_self；改名来源与句子 speaker_basis 分别报告，不把有名字的标签当作实名确认。跨资料重名不是同一人，`--speaker` 用当前资料稳定 ID。拆句 start_ms/end_ms 为 null 时明确时间未确定；source_range/parent_source_ref 仅引用原父片段，必要时 get 父 revision 核对原句，不能按文字比例估算子句时间。
- `items[].matches[]` 是命中片段（最多 10 条），可能被裁剪；需要完整上下文时用 `get` 取该修订正文。
- **先看覆盖范围再下结论**：`evidence.transcription_state` 为 `partial`/`unknown`、或 `completeness` 非 `complete` 时，没查到匹配不等于用户没说过；说明实际覆盖范围（`covered_ms`/`source_ms`）而不是"没有记录"。
- `freshness.scope=server_stored_only`、`phone_sync_status=unknown` 表示这是服务端已存内容，不代表手机本地资料完整、也未包含尚未上传的部分。
- 撤销/删除的资料以墓碑返回（`withdrawn: true`，无正文）。原音播放当前不可用（`audio_playback_available` 恒为 `false`）。
- 失败（超时、不可达、契约不符、鉴权失败）要如实报告为"查询失败"；不要把失败或空结果说成"用户没有相关记录"。

## 交付

给出结论时附上时间范围与来源引用，并注明检索用的关键词/说话人条件。区分"服务端已存资料"与手机本地实况、区分查到的原文与你的推断。工具细节、错误码与边界见 `<repo>/rebuild/material-server/query/README.md`。

## 当前验证边界

2026-10-14，源码 `a1cbf1900cc0513a98b9f106f2b6462598bd8f5b` 的 r3 服务已在腾讯云上线，真实公网 HTTPS 与实际查询 CLI 的合成后验17/17通过，见[公网记录](../../../phase1/cloud-speaker-r3-20261014-0104-speaker-verification.json)。其中包含1.2字典、未知拆句时间、不可变父来源、speaker-ID查询及增量；全部来自独占合成 owner，测试凭据已撤销。

手机实际1.2更正/上传后经此工具查询、真实用户日常资料查询、真实 Agent 会话使用此 skill 仍待验收。使用时仍须核对当前配置、凭据与实际返回，不把上述合成通过当作手机资料完整或 AC-QUERY 已完成。
