# P33 只读资料查询工具（电脑 Agent 调用入口）

`cli.mjs` 是电脑端 Agent 调用本机资料服务的唯一命令入口，`client.mjs` 是可被脚本复用的同一实现。工具只发 GET：不写资料、不建任务、不上传原音、不启动 Agent。它查到的是**服务端已存**的同步结果，不是手机本地全部资料。

调用说明的 Agent 版见 [skill/turboio-material-query/SKILL.md](../skill/turboio-material-query/SKILL.md)。

## 前提

- 运行时与服务一致：Node **22.23.2**（服务目录 `.node-version`），锁定依赖见 `package-lock.json`。
- 需要已签发、具备 `materials:read`（search/get）与 `changes:read`（changes）的凭据，和登记过的 `owner_id`/`producer_id`/`server_id`。签发方式见[服务 README](../README.md)。
- 公网地址必须 HTTPS。仅本机隔离测试允许 `http://127.0.0.1:<port>/v1/`＋显式 `allow_loopback_http: true`；`localhost`、带用户名/密码/查询串的地址一律拒绝（`HTTPS_REQUIRED`/`INVALID_CONFIG`）。

## 配置文件（唯一凭据来源）

```json
{
  "schema_version": "1.0",
  "base_url": "https://example.invalid/io-api/v1/",
  "owner_id": "user-local",
  "producer_id": "computer-query",
  "server_id": "<服务 /v1/identity 返回的稳定 UUID>",
  "credential_file": "reader.json",
  "timeout_ms": 10000
}
```

- 只接受以上字段，未知字段报 `INVALID_CONFIG`；`base_url` 必须以 `/v1/` 结尾。
- `credential_file` 相对配置文件所在目录解析，内容是 `mint` 写出的 `{token, token_id, expires_at}`，最大 4KiB、严格 JSON（重复键拒绝）。**不接受** `--token`、环境变量或命令行传入的 Bearer；把令牌写进命令行、日志或提交都会被拒绝。
- 本机按服务 README 的权限要求保护该文件（POSIX 0600）；工具只读，不改写也不输出令牌。
- 每次调用先请求 `/v1/identity`，核对 `owner_id`/`producer_id`/`server_id` 与所需 scope，通过后再发一次查询请求；身份每次重新核对，不缓存。进程内不自带重试和缓存：每次调用都是一次真实查询，是否重试由调用方决定，凭据撤销或服务换绑会在下次调用被发现。

## 命令

```powershell
node rebuild/material-server/query/cli.mjs search  --config <配置> [--from <RFC3339>] [--to <RFC3339>] [--keyword <文字>] [--speaker <ID>] [--limit 1-50] [--cursor <游标>]
node rebuild/material-server/query/cli.mjs get     --config <配置> --material-id <ID> [--revision <正整数>]
node rebuild/material-server/query/cli.mjs changes --config <配置> [--limit 1-50] [--cursor <游标>]
```

| 目的 | 用法 |
| --- | --- |
| 按时间查询 | `search --from 2026-10-11T00:00:00Z --to 2026-10-12T00:00:00Z`（按资料区间重叠筛选，不是创建时间） |
| 按关键词定位 | `search --keyword 周四`（全文＋逐句文字的大小写折叠子串，非语义检索） |
| 按说话人 | 1.2 用 `search --speaker <material_id-s稳定后缀>` 精确匹配资料内 ID；1.0/1.1 保留原 ID，不按显示名推断同人或实名 |
| 取原文 | `search`/`get` 的 `items[].body.full_text.text`、`body.utterances[]`；`get --revision N` 取某一不可变修订，`get` 不带 `--revision` 取最新 |
| 获取增量变化 | 先 `changes` 取 `next_cursor` 并保存；下次 `changes --cursor <已保存游标>` 只返回其后新增的修订与墓碑 |
| 来源引用 | 每个结果与每条匹配的 `source_ref`（`material_id`/`revision`/`text_revision`/`utterance_id`/`start_ms`/`end_ms`） |

`from`/`to` 为带时区 RFC3339；`--limit` 默认 20、最大 50。同一游标必须沿用同一过滤条件与类型，否则服务返回 `CURSOR_RESET_REQUIRED`。

## 输出约定

stdout 单行 JSON：`{"ok":true, "tool_schema_version":"1.0", "operation", "service":{...}, "retrieved_at", "freshness":{...}, "has_more", "next_cursor", "filters", "items":[...]}`（`get` 无 `filters`，`freshness.server_time`/`fresh_until` 为 `null`）。

`items[]`：`schema_version`、`body`（服务原样保存的 1.0/1.1/1.2 载荷）、`commit_seq`、`stored_at`、`source_ref`、`withdrawn`、`matches[]`、`matches_truncated`、`evidence{}`。

- `matches[]` 最多 10 条，`excerpt` 是命中位置前后截取的片段（`search` 按关键词，`get` 从开头截取），`excerpt_truncated` 标明片段被裁剪；每条自带 `speaker_id`/`speaker_basis`。
- 1.2 的 `body.speakers` 和命中 `speaker` 保留 label/label_basis/is_self；label_basis 与句子 speaker_basis 独立，仅改显示名不确认句归属。文本拆句的未知 start_ms/end_ms 均保持 null；source_ref.source_range 与 parent_source_ref 指向原父修订及父原音范围，不能将父范围冒充精确子句边界。详见 [1.2 契约](../../../docs/contracts/material-v1.2.md)。
- 墓碑（`operation: "delete"`）：`withdrawn: true`、`matches: []`，**没有** `evidence`，正文为空；`search` 永不返回墓碑。
- `evidence`：`completeness`、`processing`、`transcription_state`、`speaker_processing`、`audio_state`、`audio_playback_available`（当前恒为 `false`，原音尚未上传）、`content_role: "source_data"`。
- `freshness.scope: "server_stored_only"`、`phone_sync_status: "unknown"`：只说明服务端已存内容，不代表手机本地资料完整或已全部同步。

**查询前必须看覆盖范围**：`transcription_state` 为 `partial`/`unknown` 或 `completeness` 非 `complete` 时，没匹配到不等于用户没说过；如实说明只覆盖了哪一段（`covered_ms`/`source_ms`），不要用“没有记录”下结论。

## 错误

stderr 单行 JSON：`{"ok":false,"error":{"code","status","retryable","reset_required"}}`，退出码 1。

| code | 含义与处理 |
| --- | --- |
| `INVALID_ARGUMENTS` / `EXPLICIT_CONFIG_REQUIRED` / `INVALID_CONFIG` / `INVALID_QUERY` | 调用方输入或配置错误，改正后重试；不要自动放宽参数 |
| `INVALID_PRIVATE_FILE` / `CREDENTIAL_EXPIRED_OR_INVALID` | 凭据文件损坏、超限或过期，需重新签发 |
| `IDENTITY_MISMATCH` / `FORBIDDEN` / `UNAUTHENTICATED` | owner/producer/server 与凭据不符、缺 scope 或凭据失效；停止查询并要求重新登记，不要换用其他凭据试探 |
| `HTTPS_REQUIRED` | 非 HTTPS 且不是显式放行的回环地址；改配置或联系管理员，不要降级 TLS |
| `MATERIAL_NOT_FOUND` / `MATERIAL_DELETED`（410）／`NOT_FOUND` | 该资料不存在或已删除；删除后历史正文不再返回 |
| `CURSOR_RESET_REQUIRED`（`reset_required: true`） | 游标篡改、跨 owner、过期、改过滤条件或服务恢复旧库；必须重新从当前状态查询并重新建立检查点，**不要跳到最新后继续增量** |
| `TIMEOUT` / `NETWORK_UNAVAILABLE` / `UNAVAILABLE`（`retryable: true`） | 服务不可达或繁忙；报告失败并稍后重试，不要用本地缓存冒充查询结果 |
| `INVALID_RESPONSE` / `RESPONSE_TOO_LARGE` / `REDIRECT_REFUSED` / `HTTP_ERROR` | 响应不符合契约、超过 1MiB、被重定向或状态异常；视为查询失败，不上报为“无资料” |
| `CANCELLED` / `QUERY_FAILED` | 调用方取消或未预期的本地失败 |

## 验证

```powershell
cd rebuild/material-server
node --test tests/query.test.mjs        # 或 npm test（同时跑服务与查询两套）
node query/verify.mjs                   # 记录 verification/query-result.json 与 query-tests.tap
```

当前结果：11 项通过，使用真实临时 SQLite、真实 loopback HTTP 和真实 CLI 子进程，数据全部为合成样例。证据见 [query-result.json](../verification/query-result.json)（含源码/契约 SHA256）与 [query-tests.tap](../verification/query-tests.tap)。

2026-10-14，腾讯云实际 r3 服务已按源码提交 `a1cbf1900cc0513a98b9f106f2b6462598bd8f5b` 上线，公网 HTTPS 与实际查询 CLI 的合成后验17/17通过。reader/writer 身份声明资料1.0/1.1/1.2；实际 CLI 验证1.2字典、拆句未知时间、父r3来源、不可变原修订、资料内speaker-ID检索及r1–r6增量。此17项是该批公网发布后验，包含写入、权限及撤销检查，不是新增17项查询单元测试。证据见 [公网合成后验](../../phase1/cloud-speaker-r3-20261014-0104-speaker-verification.json)及[真实发布记录](../../../docs/product/phase2-speaker-server-release-preparation-2026-10-13.md)。独占合成测试凭据已撤销，不能用于日常查询。

## 当前边界

腾讯云部署、真实公网 HTTPS 和电脑实际 CLI 查询的合成链路已有上述证据；较早的手机1.1合成同步/离线补传另见[手机离线恢复](../../../docs/product/phase3-phone-offline-recovery-2026-10-12.md)。手机实际1.2更正/上传与该工具查询的贯通、真实用户日常资料检索，以及真实 Agent 会话通过此 skill 查询仍未验收。原音未上传（`audio_playback_available` 恒为 `false`）。这些合成单项不能用于宣称手机资料完整、日常查询已可交付或 AC-QUERY 已达验收。
