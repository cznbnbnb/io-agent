# P23 资料 1.2：当前资料的说话人标签与拆句来源

这是独立版本的资料修订扩展，完整严格 Schema 为 [event-v1.2.schema.json](./event-v1.2.schema.json)。1.0、1.1 文件和事件规则不变；普通无标签文字资料仍可使用 1.1。消息、任务、请求、答案和回执继续使用现有 1.0 接口。

## 能力协商与修订

已认证 `GET /v1/identity` 顶层新增 `material_schema_versions: ["1.0","1.1","1.2"]`；identity 自身的 `schema_version` 仍为 `1.0`，既有 `capabilities: ["request_lifecycle_v1"]` 保留。旧服务缺少版本声明时，手机只能沿用原 1.0/1.1 兼容约定，不能删掉 speakers/source_range 伪造 1.1 上传。

1.2 使用相同 event_id、producer_id、idempotency_key、期限、Bearer owner 边界、RFC8785 摘要、256KiB 事件上限、资料 revision/base_revision CAS 和 SQLite 事务。上传同一事件复用耐久保存的信封；到期后只重新签发完全相同的不可变资料修订，不能改变已保存正文。服务只产生 `server_stored` 回执，不表示眼镜显示、用户回答、Agent 收到或任务完成。

全文、逐句归属、speaker 字典或 source_range 变化都计入 `text_revision`；变更时必须恰好加一。现有 1.2 资料不能降级为 1.0/1.1 丢弃字典（409 `SCHEMA_DOWNGRADE_REFUSED`）。新增 1.2 版本不改变数据库结构：不可变修订 JSON 完整保存所有字段。

## speakers 字典

1.2 body 必填 `speakers` 数组（无说话人可为空）。每项严格只有四个字段：

| 字段 | 语义 |
| --- | --- |
| `speaker_id` | `material_id + "-s" + suffix`。后缀 1–128 个 ASCII 字母、数字、`_.:-`，首字符为字母或数字；完整 ID 最多 512 字符。分配后在该资料内稳定，不由显示名字、数组下标或全局 VoiceRole 身份生成。 |
| `label` | 当前资料显示标签，非空、非全空白、最多 80 个 UTF16 code unit；禁止 C0/C1 控制字符。 |
| `label_basis` | `anonymous / user_confirmed / role_match`。显示名字的来源，与句子归属来源分别表示。 |
| `is_self` | 布尔值。为 true 时必须 `label_basis=user_confirmed`，整个资料最多一项为 true；匿名、声道、骨传导或角色自动匹配不能据此冒充用户。 |

ID 不重复；每个非 null 的 utterance.speaker_id 必须在字典中。`speaker_basis` 沿用 `unknown / segment_cluster / user_confirmed`：unknown 要求 speaker_id=null，另两种要求存在 ID。仅改名不自动把各句升为 user_confirmed；显式人工改归属或合并时才确认相应句子的归属。重名的两个资料仍是两个独立身份范围，不能当同一个人。

不上传 embedding、声纹、bio、VoiceRole 对象或任意附加字段。原有 `processing.speaker` 表示模型处理状态；改名、标记为我、合并或拆分均不把 pending/unavailable 伪装为 processed。

## 拆句与 source_range

原 utterance.start_ms/end_ms 的非负整数语义保留；仅文本拆句无法证明精确子句时间时，两者必须同时为 null，并带有以下严格六字段 source_range：

```json
{
  "parent_utterance_id": "utterance-original-a",
  "parent_revision": 3,
  "start_ms": 100,
  "end_ms": 1000,
  "text_start": 0,
  "text_end": 6
}
```

这是字段说明，text_end 必须按实际父句计算；不是可用于任意句子的载荷。parent_revision 必须为当前修订之前的正整数，parent_utterance_id 必须存在于同 owner、同 material 的指定不可变父修订。start_ms/end_ms 精确引用父句原范围；若父句本身已经为 null，沿其 source_range 原范围。text_start/text_end 是父句 UTF16 文本的半开区间，非空、在父句范围内、不能切开 surrogate pair；首次拆句的父文本 slice 必须与当前子句文本完全相等。跨资料、跨 owner、缺父句或伪造范围均拒绝。

之后允许人工更正拆句文字：服务器当前修订已存在同一 utterance_id、完全相同 source_range 和子句时间，当前修订明确 user_edited=true，文字变化有效增加 text_revision，同时 processing.boundary 必须为 unknown。该引用继续锚定原 ASR 父片段，不声称人工更正与父原文字面相同。后续改名/标记为我可保留已验证锚点和更正文字，但不能从当前 unknown 恢复旧父句的 token_starts；新增子句 ID、替换范围或第一次拆句不能借此跳过切片校验。父修订、原音范围、UTF16 边界和来源/覆盖校验仍每次执行。

不能按字数估算子句时刻。数字子句时间如果同时附 source_range，必须在父原范围内；null 子句的引用范围只是可回放父片段，不是精确子句定位。查询应显示未知时间，不能用父范围替换子句 start_ms/end_ms 使其看似精确。

拆句需 `processing.user_edited=true`。来源、原音状态/摘要、采集起止、采集完整性、转写覆盖及其总长度、transcription_state、speaker 模型状态和 recognition_channel 与父修订保持一致。boundary 可保持父值或降为 unknown，不能升级。原音不变不代表已上传：本地 audio.local、sha256 或引用均不生成 stored_verified/object_id。

本批唯一原音可用性例外是同一资料、同采集起止/完整性及同原音处理总长度和覆盖下 `audio.local → audio.missing`：missing 的 sha256/object_id 均为 null，不改变父原音范围或历史引用。父修订保留当时 local 事实，当前修订如实说明原音已不可用。当前修订也参与单向校验，不能据旧父 local 将当前 missing 恢复为 local，或借此替换摘要、来源、时长或覆盖。后续文字更正可继续保留该原父片段引用，当前原音不能播放。这是当前尚未完成原音校验闭环的保守边界，非最终产品对恢复原音的限制；P21 后续应支持原父有非空 verified SHA 且恢复文件实测为完全相同摘要的原音恢复，需独立完成协议与真机验证，本批不通过这项可用性例外宣称已支持。

删除 1.2 资料的墓碑要求 speakers/utterances 均为空、full_text.text 为空；删除不复活旧正文。原有去重、墓碑优先和历史读取限制不变。

## 查询及错误

search/get/changes 原样返回完整 1.2 body。`--speaker` 精确匹配 material 内稳定 ID。命中的 `matches[].speaker` 返回完整四字段字典项或 null，`matches[].speaker_basis` 单独保留句子归属来源。body.speakers 可用于没有命中文字的完整字典展示。

子句引用 `source_ref.start_ms/end_ms` 保持 null；另带原样 `source_range` 和 `parent_source_ref`（同 server_id、owner_id、material_id，指定父 revision/utterance_id 及父范围）。调用方可据此 get 原父修订，不能把其时间作为子句精确边界。覆盖、新鲜度、原音可用性按现有查询证据单独报告。

除既有错误，400 `INVALID_SPEAKER_DICTIONARY / INVALID_SPEAKER / INVALID_SOURCE_RANGE / SOURCE_PARENT_NOT_FOUND / SOURCE_RANGE_SOURCE_CHANGED / SPEAKER_EDIT_SOURCE_CHANGED / INVALID_COVERAGE` 表示格式、字典关系或父来源验证不成立；只更正标签/归属时不得顺带更改原音来源、覆盖或声道/说话人模型状态。409 `TEXT_REVISION_CONFLICT / SCHEMA_DOWNGRADE_REFUSED` 表示修订版本矛盾。均不能删除字段重试或把拒绝响应当作存储成功。

[按序合成 r1–r4 样例](./material-v1.2.json)分别为模型匿名标签、仅改显示名字、显式合并归属、无精确子句时间的拆句。没有真实名字、声纹、真实待办或任务副作用。实际本机 HTTP/SQLite 和 CLI 验证见 `rebuild/material-server/tests/speakers.test.mjs`；上线、手机真机上传、识别准确率和跨日身份仍需各自证据，不能由 Schema 或这些合成测试宣称通过。
