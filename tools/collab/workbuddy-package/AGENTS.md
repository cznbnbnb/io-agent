# Agent 接入 cz-iot-cli

CLI 0.2.6 起个人词库按账号存于服务器，多电脑共用。订正前用 `lexicon query` 批量找已核实写法，按 [词库说明](rebuild/agent-bridge/questions/LEXICON.md) 查本次语境；只有实际核实使用才 `use` 续期，不能读全库就给所有词续期。新词必须带依据，可在成功订正后由 `lexicon_entries` 保存，不能按 diff、音近或已有词条猜测当前发言人和责任。查询不续期，连续六个自然月未用自动清理。个人词条不打入公开包。

CLI 0.2.5 起完整内置 **cz-lifelog-correct V4**。开始智记订正前运行 `node cz-iot-cli.mjs skill check`，再运行 `node cz-iot-cli.mjs skill read` 并读取其引用的参考规则。`skill` 返回实际入口、脚本与文件列表。`help/daily` 中的 `correction_guidance` 是索引与摘要，不能替代完整流程。脚本仅作本地 prepare/request/verify，不替 Agent 判断证据是否成立，不自动写服务器。后续 `update` 同步更新 CLI 和随包技能，保留原配对与技能目录外的台账。旧定时任务若写死了独立技能路径，需改为先读取 CLI 随包版本；不要擅自更改任务调度或写回范围。

先阅读 README.md。正式入口是 `node cz-iot-cli.mjs`；若已安装本地命令，也可用 `cz-iot-cli`。旧 `io-agent.mjs` 仅作兼容入口。仅操作这个解压包和当前任务，不修改原手机 App、其他电脑登记或其他会话。

1. 先运行 `node setup.mjs doctor`。`computer.paired=true` 已验证电脑授权，直接进入本会话 `join`，不再执行扫码步骤；`false` 才由真实会话运行 `node cz-iot-cli.mjs pair`，stdin 包含 topic 与实际 workspace，向用户展示二维码 HTML 和 pairing_string。`null` 表示已有授权但验证失败，按 `computer.error` 排查连接或撤销状态，不把网络失败说成未绑定、不让用户反复扫码。doctor 同时返回 CLI 绝对路径与版本；同一系统用户共用用户目录授权，不因切换项目或解压新版改变 `IO_AGENT_DEVICE_FILE` / `IO_AGENT_PAIRING_HOME`。手机核对电脑授权范围后保存；不要走登记文件回传/导入流程，不索要其他电脑密钥。
2. 宿主提供真实 `IO_AGENT_CALLER_RUNTIME=workbuddy` 和 `IO_AGENT_CALLER_SESSION`。无法确认真实会话 ID 就说明阻碍，不自行编造 ID。
3. 用 `pair-status`（stdin 为 `{}`）检查手机是否确认；waiting_for_phone 时等同一次配对，不反复建新绑定。paired 后，新会话自动复用电脑授权。可调用一次 `node cz-iot-cli.mjs join`，stdin 为 `{"topic":"本次任务主题"}`；首次 ask/notify/checkpoint 也会自动 join。随后调用 config，stdin 为 `{"glasses_progress":false}`。进度推送保持关闭，不执行参考合同里的默认开启要求。
4. 依次 ask、wait，收到答案后继续本会话。一次只问一个问题；pending 继续等原 request_id，不重复建题。看完整原话，不只看选项 ID。
5. 不冒充手机已展示，不把问答成功当作支持远程启动或打断 WorkBuddy。问答凭据过期/会话 ID 缺失等错误如实报告。
6. 不把当前运行产生的凭据、SQLite 日志、连接文件回传到聊天或打进分发 ZIP。
7. 查询日常智记时使用 `node cz-iot-cli.mjs daily`，stdin 为 `{"date":"YYYY-MM-DD"}` 或 `{"from":"YYYY-MM-DD","to":"YYYY-MM-DD","keyword":"关键词"}`。查询已配对电脑的总结、分段智记和逐字转写，不需要真实 session ID、join 或 Python；这项例外不改变问答的会话身份规则。指定日期自动取全，显式分页时按 has_more/next_cursor 取全页，保留过滤条件。空结果只代表服务端暂无匹配总结，不能说用户没有活动；不请求原音或手机调试接口。完整说明见 `rebuild/agent-bridge/questions/DAILY-SUMMARIES.md`。
8. 提出原厂待办建议时使用 `node cz-iot-cli.mjs todo-add`，stdin 为 `{"todo_key":"稳定的事项标识","content":"单行且最多48个UTF-16代码单元的待办","source":"WorkBuddy"}`。此命令同样复用电脑配对，不需要 session、join 或 Python。眼镜先显示建议，用户确认后才创建原厂待办；用 `todo-status` 和返回的 `proposal_id` 查询结果。只有 `native_created:true` 才能报告原厂创建成功；结果未知时不能换键重发，也不能把创建成功说成用户已看见。完整说明见 `rebuild/agent-bridge/questions/NATIVE-TODOS.md`。
9. 用户要求更新时先执行 `node cz-iot-cli.mjs update --check`，再执行 `update`；两条命令均可加 `--https` 用 Git 匿名读取公开仓库。不复制用户密钥，不修改仓库可见性，不自动关闭活跃 Agent；常驻连接器等任务结束后再重启。配对和私有目录保留，更新代码不代表重开一次绑定。
10. CLI 0.2.1 起，订正前阅读 `daily` / `daily-history` / `help` 的 `correction_guidance`。每日总结和分段智记保留原日记口吻、视角、标题和自然段节奏；事实优先，必要时删改或重组相关段落。编辑说明只放 `reason` / `evidence`，不写入正文；不能仅凭 `speaker=others` 断言本人未参与。逐字转写保持原话结构，仅在用户授权时使用 `daily-note` 记录后续事实。`summary_stale` 优先保留本轮写前有效摘要，用 `daily-history` 核实最后有效稿；`original` 不是上一版订正文字，再结合有效转写修正；提交后用 `daily` 回读确认。详细规范见 `rebuild/agent-bridge/questions/DAILY-SUMMARIES.md`。
11. CLI 0.2.2 起，分析、提取本人待办及订正必须结合逐字转写 `blocks[].speaker`、时间和上下文，不能只读没有说话人标注的合并 `text`。`me`/`others` 分别为原厂标注本人/旁人，缺失或不明按未知处理；不能把旁人讨论算成本人工作，也不能仅凭旁人发言就断言本人未参与。用现有已授权微信、飞书及项目资料核对相关人名、品牌、型号和责任等信息，过往认知作线索；查看相关日期/实体的完整消息，不能凭词频、模糊命中或零命中强改。`reason/evidence` 记渠道、时间、可核查来源及支持的改动；没有访问能力时如实说明。CLI 不提供微信/飞书接口，不修改结构化说话人标签。
12. CLI 0.2.3 起，Codex Desktop 原聊天接入不再卡 App 版本或安装哈希，按实际握手、原持有者能力、设置和状态判断。macOS 原聊天远程入口使用 `join {"control":"desktop"}`，随后核对 `session-status.can_execute`。旧版版本拦截先更新CLI再在原聊天重新join，不重新配对、不另开聊天、不修改Desktop启动环境。实际协议错误不猜格式重发命令；仅云端在线不代表可远程执行。


2026-11-02：`daily` 已升级为已同步智记文字查询，指定日期自动收齐总结、分段与转写。新增 `daily-correct`、`daily-note`、`daily-history`、`daily-revert`；订正在服务器单独保存，不回写手机。原音仍不上传。以 `help` 和 `rebuild/agent-bridge/questions/DAILY-SUMMARIES.md` 为准。
