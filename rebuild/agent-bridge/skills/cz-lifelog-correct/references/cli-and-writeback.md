# CLI、计划格式与写回校验

以下来自已验证的 cz-iot-cli 0.2.2、lark-cli 1.0.99 和微信云端远程 CLI 接口。目标机先用帮助确认兼容性；版本变化时以实机帮助及 `correction_guidance` 为准。不要为套用示例切换账号或身份。

## 1. 日期与云端快照

```text
python <skill_dir>/scripts/lifelog_review.py date
python <skill_dir>/scripts/lifelog_review.py date --date 2026-11-02
```

输出日期、北京时间目标日边界和可用的相邻窗口。历史日期默认前后两天；昨日任务的右边界截到现在，不查询未来。

`cz-iot-cli` 使用命令 + JSON stdin，不是 URL 查询参数。调用模式（Python，Windows/macOS 均可使用）：

```python
import json, subprocess
from pathlib import Path

command = ["cz-iot-cli"]  # 或目标机已验证的 argv 前缀
payload = {"date": target_date}  # target_date 来自日期计算
r = subprocess.run(command + ["daily"], input=json.dumps(payload, ensure_ascii=False),
                   capture_output=True, encoding="utf-8")
if r.returncode:
    raise RuntimeError(r.stderr or r.stdout)
data = json.loads(r.stdout)
if data.get("error") or data.get("ok") is False:
    raise RuntimeError("daily failed; inspect the saved error without printing credentials")
Path("before.json").write_text(r.stdout, encoding="utf-8")
```

只读命令：

| 命令 | stdin 示例 | 关键点 |
|---|---|---|
| `daily` | `{"date":"YYYY-MM-DD"}` | 自动收齐该日；含 summary、segment、transcript |
| `daily` | `{"from":"YYYY-MM-DD","to":"YYYY-MM-DD","limit":100}` | 多日扫描才用；显式 limit 后调用者负责分页，续页保留所有筛选并传 cursor |
| `daily-history` | `{"material_id":"实际 ID"}` | 原始版本在 `original.source_revision`，不是 `original.revision`；`items` 为订正历史 |

判断 `complete`、`has_more`，不要把单页当完整日。若 `CURSOR_RESET_REQUIRED`，本次读取从头重来；不要混合两次分页结果。单页/自动合并超限时按日期/类型缩小，完整取回后保留各响应并汇总完成状态。

`coverage.scope=server_stored_lifelog_text` 和 `phone_sync_status=unknown` 不证明手机全部上传。空云端日记不代表没有活动。原始音频不在这个接口内。

## 2. 飞书与微信的快速查证

### 飞书

先沿用用户身份，输出 JSON，省掉无关表情读取。把占位值替换为当前疑点和 ISO +08:00 时间：

```text
lark-cli im +messages-search --query "实际项目词" --start "窗口起点" --end "窗口终点" --page-size 50 --page-all --page-limit 40 --no-reactions --as user --format json
```

可用 `--chat-id` 限定一个或多个已确认会话，`--sender` 限定发言者，或 `--is-at-me` 寻找相关事件。对已知相关会话按时段取上下文时 `--query ""`；不要把“订正”“总结”等任务词当搜索词。身份、会话、时间都是检索条件，不能只看关键字。

返回 `.ok` 和 `.data.messages`，检查 `.data.has_more`。`--page-all` 仍受页数上限约束；先续实际返回游标，无法完整取回时按 6 小时等更小时间窗读取，并用 `message_id` 去重。时间边界可能重叠，不能依靠时段不重叠来保证不重复。截断结果只能叫“部分命中”，不能据此作否定结论。

读取完整线程/会话可用 `im +threads-messages-list`、`im +chat-messages-list`；先看该版本 `--help`，不要猜参数。不要因需要读取个人数据而换成 bot 身份，后者可见范围不同。

### 微信

首次用 `account list` 确认目标账号。开始一轮可执行一次 `sync --account ACCOUNT` 并检查返回状态；它不能保证离线采集电脑产生的消息已经上传。随后查询加 `--no-sync`，避免每次等待刷新。同步失败时仍可读云端缓存，但记录覆盖限制。

```text
wxcli read --account ACCOUNT --from "窗口起点" --to "窗口终点" --limit 500 --order asc --no-sync
wxcli read --account ACCOUNT --chat "已确认会话" --from "窗口起点" --to "窗口终点" --limit 500 --order asc --no-sync
wxcli search --account ACCOUNT --kw "实际实体词" --limit 100 --no-sync
```

`wxcli` 表示目标机的命令前缀（可能是 Python + wxcli.py）。当前 `search` **没有时间范围参数和分页游标**；用它定位线索后，必须 `read` 相关会话/时间确认，不把截断搜索当全量结果。日期读取通常在 `.data[0].result.items`，下一页 `.data[0].result.next_cursor`，非空则将 `--cursor` 加到原筛选继续；先确认响应确实是目标账号。按 `message_id` 去重，保留 `body`、`reference_id`、发送者和时间。引用消息不是附件。

### 文档与会议

优先用消息里已有的文档链接、会议 ID，避免全空间盲搜。已有 Doc token：

```text
lark-cli docs +fetch --doc TOKEN --doc-format markdown --as user --format json
lark-cli vc +search --start "窗口起点" --end "窗口终点" --page-size 30 --as user --format json
lark-cli vc +detail --meeting-ids "会议ID1,会议ID2" --as user --format json
lark-cli note +detail --note-id NOTE_ID --as user --format json
```

`vc +detail` 用复数 `--meeting-ids`。从返回的 `note_id` 查详情，再读取实际返回的 `verbatim_doc_token`；不同类型逐字稿也可能由 `note +transcript` 提供，先查帮助。不要凭 meeting_id 猜 note_id 或 minute_token，也不要虚构 `minutes +transcript` 命令。`minutes +detail --transcript` 可能缺 `minutes:minutes.artifacts:read`，遇到缺权限记录一次，改读已可访问的关联文档/逐字稿及同期消息；不要反复调用失败接口。

表格要读取相关工作表和单元格，PDF/图纸要实际打开所需页。使用目标机已有文档工具或相应 CLI 帮助，不以文件名代替内容。

### 有界重试

429 或明确临时网络错误，按服务建议等待，最多重试 3 次；同一服务降低并发。认证、scope、非法参数不会靠重试解决。权限失败不要重复发起授权；记录来源不可用，继续有独立证据的部分。写入超时不代表未成功，先保留并重试**同一请求 ID 和正文**或回读核对；不能生成新 ID 重写。

## 3. 辅助脚本使用

脚本全部离线，无自动写入或登录。建议每次独立运行目录：`before.json`、`after.json`、`read/`、`plans/`、`requests/`、`responses/`、`sources/`、`audit.json`、`ledger.json`。它们是数据，不应打包进技能。

```text
python <skill_dir>/scripts/lifelog_review.py prepare --snapshot before.json --out read
```

若复跑同一天，可额外 `--ledger 上次ledger.json`。仅 v4 台账中无待核且审核完毕的相同指纹可作复用线索；新证据或未解决问题仍需核对。脚本不自动宣称材料已审。

`read/decisions.json` 每个材料填写：

```json
{
  "material_id": "实际 ID",
  "status": "corrected",
  "reason": "同事件逐字稿及物料消息支持识别订正",
  "evidence_refs": ["sources/实际证据文件.json#消息或段落定位"],
  "unresolved": []
}
```

`status` 为 `corrected`、`verified_unchanged`、`unresolved`；后者须写具体待核问题。只刷新摘要依赖、正文不变且无未决疑点用 `verified_unchanged`。一份材料既有已改段也有疑点时用 `corrected` 并填 `unresolved`。`pending` 不能通过最终验证。

### v4 的全日事件表与逐段断言

`prepare` 创建空的 `read/events.json`，与 `decisions.json` 放在一起。先按 [归属与串场规则](event-review.md) 建事件条目，全日共用简短的本地 ID。实际填入可核验的来源和原话。下面是虚构的格式示例。

```json
{
  "lens_call": {
    "scene": "18:35–18:39 本人与工程师的镜头电话。挂断前商量验证方法。",
    "relation": "own",
    "sources": [{"ref": "同日镜头电话 18:38 本人发言", "quote": "我先把两批样机的记录发你。"}]
  },
  "review": {
    "scene": "19:03 同事开始门铃评审。期间本人另向助手口述，按两件事分别记录。",
    "relation": "background",
    "sources": [{"ref": "同日评审开场 19:03 主持人", "quote": "我先把还没关的问题筛出来。"}]
  }
}
```

`relation` 用 `own`（本人经办或亲历）、`participated`（有限参与）、`background`（现场背景）或 `uncertain`（归属待核）。在 `scene` 中记明时间、对象、本人角色。混杂时说明分界或重叠线索。`sources` 支撑这项归属判断，归属未知时列出已读到但不足以定人的原话。只存必要引文。

对分段、标题、提纲、每日总结的最终候选正文逐段复核。键为 `block_id#N`，N 从 1 起，按空行划分非空自然段。每个关键断言填写属于哪个 `event`、正文如何使用它（`use`）、最终正文连续原句和该断言的证据。同一事件的背景事实可以用 `context`，本人有据的动作用 `personal`，支撑个人日记主线的短句用 `focus`。一段可有多项检查，分属不同场景时分别摘句。不要把同一短句的因果两端分挂到两个事件以回避核查。

```json
{ "fact_review": {
  "summary#1": {"no_risk": "原有日期标题，不含事件判断"},
  "summary#2": {"checks": [
    {"text": "你答应把两批样机的记录发给工程师", "event": "lens_call", "use": "focus", "sources": [{"ref": "同日镜头电话 18:38 本人发言", "quote": "我先把两批样机的记录发你。"}]}
  ]},
  "summary#3": {"checks": [
    {"text": "同事开始筛未关闭的问题", "event": "review", "use": "context", "sources": [{"ref": "同日评审开场 19:03 主持人", "quote": "我先把还没关的问题筛出来。"}]}
  ]}
}, "neutral_focus_reason": "" }
```

日总结在标题、开篇或总结句标记真正的 `focus`。若确实没有可核实的个人主线，改为中性叙述，并在该材料的 `neutral_focus_reason` 填写具体原因，保留各段实际可核实的事实。不要用中性理由给仍在声称“今天你主导了……”的正文放行。`background`、`uncertain` 只能用作 `context`。对 `participated` 的事件，断言中动词的力度要与本人实际参与的动作相称。

若证据只支持较弱说法，先收窄原句，对保留的事实填正常检查。无法进一步确认的单位或负责人另列入材料的 `unresolved`。确需在正文保留未决内容的写法为 `{"text":"候选中的确切措辞","event":"事件ID","use":"context","open":"具体哪项还需哪份证据"}`，同时把相同问题写入该材料的 `unresolved`。确无事实断言的日期或过渡可写具体 `no_risk`。对原文中未证实的归属或因果须先处理，不能仅登记后原样肯定地写回。

写前检查和最终检查共用同一套规则。助手仍需亲自确认原话证明的是哪一步、日记是否保留原有文风。检查表只留在本地，云端只提交原接口需要的正文和必要依据。

每个材料的计划文件：

```json
{
  "material_id": "实际 ID",
  "source_revision": 1,
  "correction_revision": 0,
  "dependencies_version": "总结填写新鲜 daily 返回值；转写可省略此字段",
  "agent": "WorkBuddy",
  "reason": "具体订正理由，正文不变的确认也需说明",
  "evidence": ["渠道、日期时间、消息ID/文档版本与位置、必要引文，以及支持的 block_id/改动"],
  "edits": [{"block_id": "实际 block ID", "before": "当前有效原句", "text": "订正后的完整该段正文"}]
}
```

提交前重新取 `fresh.json`，然后：

```text
python <skill_dir>/scripts/lifelog_review.py request --snapshot fresh.json --plan plans/material.json --decisions read/decisions.json --out requests/material.json
```

摘要请求必须传 `--decisions`；即使只改一个字或同文恢复，提交前也要对这份摘要的全部块（含标题和提纲）填完记录。多批提交时按该批生效后的候选文字核对锚点。转写请求可省略。摘要已失效时加 `--baseline before.json`。脚本检查原文/订正版本、摘要依赖版本、before 文本、段落 ID、200 段/1 MiB 限制，并由请求内容生成稳定 ID。普通无变化请求被拒绝；失效摘要重新确认可提交一段同文。如需超过 200 段，先分批，成功回读后用新订正版本生成下一批。

将生成的 JSON 原样传给 `cz-iot-cli daily-correct` 的 stdin，保存响应，检查 `server_stored=true`、对应 material_id 和订正版本。`requests/` 只纳入实际成功的请求；拟稿或失败请求另存。多次传输同一幂等请求只保留一份。

## 4. 摘要、冲突与中断恢复

转写全部成功后回读日数据。逐个修正/重新确认受影响的 segment，然后再次回读，最后处理 summary。**每个摘要写入前的 `dependencies_version` 取最近一次 `daily`**，不能沿用写转写前的值。

失效摘要的处理：

1. 保存新鲜失效状态，再用 `daily-history` 检查原始版本与历史。`original.source_revision` 应与当前 `revision` 一致。
2. 有本轮开始时的有效摘要快照且两个版本一致，直接作为正文基线。基线已包含以前的订正，不能替换成裸 `original.blocks`。
3. 若开始时就失效、没有有效快照，需要按真实返回的历史结构恢复最后有效正文，包含此前订正/撤销/冲突状态；分页取齐相关历史。不要盲目把所有历史 edits 重放到新原文。无法可靠恢复时保留该材料待处理并如实报告，不假称摘要已有效。
4. 对照更新后转写，保留正确的既有摘要，只改事实错误。正文不需要改时提交一段原有效正文并带最新依赖版本，重新确认它。

`CORRECTION_CONFLICT` 或 `needs_review`：重读当前原文、现有订正和历史，合并有依据的改动。辅助脚本会拒绝未解决的源冲突；确需处理时按实机接口契约手工构造已核对的新请求，成功后保存新的基线再继续。不要为了通过校验改旧快照或编造版本，也不要覆盖其他 Agent 已完成的正确订正。

中途停止后：读取保存的请求响应，再取云端现状；已成功的请求不重新生成新 ID，未确定的请求先用相同文件核对/重试。按目前的版本接着做尚未完成的材料和摘要，不能从旧计划整批重跑。

## 5. 最终验证

成功请求保存在 `requests/`，响应单独放 `responses/`；全量回读为 `after.json`：

```text
python <skill_dir>/scripts/lifelog_review.py verify --before before.json --after after.json --requests requests --decisions read/decisions.json --out audit.json --ledger-out ledger.json
```

脚本验证每份材料有明确复核结论、请求版本链与云端一致、所有计划文字准确生效、未计划块不变、ID/时间/speaker/原文版本不变、摘要不失效且无冲突。`audit.json` 含差异；校验不通过不会输出新的已验证台账。v4 最终检查**所有**摘要块（包括没有请求的材料），要求各段均有复核记录，并分开报告有引文的断言和留待核查的断言数。台账保存本材料用到的事件及其定位。v2/v3 台账可以提供查证线索，升级后要重新审阅归属与串场。它不会证明文字计划保留了原文风格；整篇同属一个 block 时，整篇重写也可能通过这些结构检查，因此还必须按 [文风示例](style-guide.md) 逐句核对。运行中新增材料、原文被手机更新或其他 Agent 写入都应重新核对后形成真实的新基线，不能把差异硬忽略。

首次就失效的摘要需先恢复有效正文作为明确标注的复核基线，同时保留未加工的原响应和恢复依据。空列表通过机器比对不代表真实世界没有活动。脚本验证结构与实际落库结果，**不替代 Agent 对证据含义和文风的判断**。
