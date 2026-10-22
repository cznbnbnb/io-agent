# P33 日常资料查询工具与调用说明（本机验证记录）

日期：2026-10-11。承接[资料服务](./phase3-material-service-2026-10-11.md)，按[开发顺序](../product/DEVELOPMENT-PLAN.md)第 6 节 P33 执行：先做出真实可运行的查询工具，再写调用说明。此文件记录结果，不替代 DEVELOPMENT-PLAN 顺序或 PRD 正式验收。

本批只增加电脑端只读查询代码、验证记录与调用说明；未修改鸿蒙 App 源码、未安装手机候选包（手机仍为已验证的 0.1.45）、未部署腾讯云、未上传原音、未启动任何 Agent 任务、未读取用户真实资料。全部素材为 `docs/contracts/` 合成样例。

## 1. 新增内容

| 文件 | 作用 |
| --- | --- |
| [query/client.mjs](../../rebuild/material-server/query/client.mjs) | 只读查询实现：配置与凭据校验、身份/scope 门禁、单次请求、结果结构校验与来源引用 |
| [query/cli.mjs](../../rebuild/material-server/query/cli.mjs) | Agent 调用入口；`search`／`get`／`changes`，stdout 结果、stderr 结构化错误 |
| [query/README.md](../../rebuild/material-server/query/README.md) | 调用说明：配置、命令、输出约定、错误码、边界 |
| [skill/turboio-material-query/SKILL.md](../../rebuild/material-server/skill/turboio-material-query/SKILL.md) | Agent 版调用说明（skill 包） |
| [query/verify.mjs](../../rebuild/material-server/query/verify.mjs) | 证据入口：跑查询套件并记录测试项与源码/契约 SHA256 |
| [tests/query.test.mjs](../../rebuild/material-server/tests/query.test.mjs) | 查询工具测试（11 项，含真实 CLI 端到端一项） |

P33 要求的五项能力与覆盖它的测试：

| 要求 | 覆盖 |
| --- | --- |
| 按时间查询 | 时间范围重叠筛选（`search --from/--to`） |
| 按关键词定位 | 全文＋逐句文字的大小写折叠子串，返回命中片段与裁剪标记 |
| 取原文 | `items[].body.full_text.text`／`utterances[]`；`get --revision N` 取不可变历史修订 |
| 获取增量变化 | `changes` 签名游标；终页游标可继续轮询，墓碑只返回删除标记 |
| 来源引用 | 每条结果与每条匹配的 `source_ref`（资料 ID／修订／文字版本／句 ID／起止毫秒） |

## 2. 安全与语义约束（已实现并被测试覆盖）

- **只读**：实现里没有写入路径，测试断言所有请求都是 GET；不改资料、不建任务、不上传原音、不启动 Agent。
- **凭据只来自私有文件**：配置里的 `credential_file`（相对配置目录解析，≤4KiB，严格 JSON）；不接受 `--token`、环境变量或命令行 Bearer；错误输出与日志不含令牌。测试验证了传入 `--token` 会得到 `INVALID_ARGUMENTS` 且不泄漏令牌。
- **先验身份再查资料**：先调 `/v1/identity`，核对 `owner_id`／`producer_id`／`server_id` 与所需 scope，不一致即 `IDENTITY_MISMATCH`／`FORBIDDEN`，测试确认此时请求只到达身份接口。
- **传输约束**：非 HTTPS 只允许显式放行的 `127.0.0.1`/`[::1]` 回环；不跟随重定向（不把 Bearer 转发到别处）；响应上限 1MiB；每次调用先核对身份再发查询请求（两次 GET），身份每次重核而不缓存，不自动重试。
- **不掩盖缺口**：游标失效返回 `CURSOR_RESET_REQUIRED`（`reset_required: true`），必须重新查询而不能跳到最新继续增量；`freshness.scope=server_stored_only`、`phone_sync_status=unknown`；转写覆盖不完整时（`partial`／`unknown`）明确保留覆盖范围，避免把“没查到”读成“用户没说过”。
- **原音不可用**：`audio_playback_available` 恒为 `false`；删除后历史正文不再返回。

## 3. 验证结果

运行环境：Node **v22.23.2**（与服务一致），真实临时 SQLite 文件、真实 loopback HTTP、真实 CLI 子进程；无 mock 数据库。

- 查询套件 **11/11 通过**，其中新增的真实 CLI 端到端一项依次验证：时间＋关键词＋说话人检索命中原文、来源引用含句 ID 与起止毫秒、`partial` 覆盖状态如实返回、`changes` 终页游标只拉取其后新增修订、`get --revision 1` 仍返回被更正前的原文、`get` 默认返回最新修订。
- 服务套件 **18/18 通过**；`npm test` 现共 **29 项**全通过。
- 项目级回归 `rebuild/phase1/verify.ps1`（鸿蒙 App 套件＋契约一致性）通过，本批未改动 App 源码。

证据（测试元数据与 SHA256，不含任何凭据或用户原话）：

- [query-result.json](../../rebuild/material-server/verification/query-result.json)：状态、测试项名称、源码与契约 SHA256。
- [query-tests.tap](../../rebuild/material-server/verification/query-tests.tap)、[query-runtime.log](../../rebuild/material-server/verification/query-runtime.log)。
- 复现命令：`cd rebuild/material-server && npm test`；`node query/verify.mjs`。

## 4. 调用说明与 skill

调用说明已写完：[查询工具说明](../../rebuild/material-server/query/README.md) 给出配置文件格式、三项命令、输出结构、错误码与处理方式；Agent 版写成 skill 包 `turboio-material-query`，按 skill-creator 的结构校验（frontmatter 键、hyphen-case 名称与目录一致、描述长度与禁用字符、无未完成占位）通过。skill 的关键约束是：只用真实查询结果、引用必须带来源、覆盖不完整时不得下“没有记录”的结论、凭据或配置缺失时停下来说明而不是编造。

**尚未安装到任何 Agent 的技能目录，也未在真实 Agent 会话中用过**；安装位置与是否启用属于用户决定，本批不改动本机技能目录。

## 5. 仍未完成

- 未部署腾讯云、未验证 HTTPS 反代与真实凭据轮换，工具目前只在本机回环下验证过。
- 未接真实手机同步队列：查询结果只代表服务端已存内容，手机本地资料完整性与同步滞后未验证。
- 未上传原音，无法回听或核对音频与文字的对应关系。
- **P34 未开始**：还没有用真实 Agent 结合办公消息解释一组真实的承诺/时间冲突，也没有把生成结果回存 App。
- 因此 AC-QUERY 与“电脑 Agent 能了解我的日常”这一里程碑仍未达标；本批只证明查询工具本身可用、可复核、边界明确。
