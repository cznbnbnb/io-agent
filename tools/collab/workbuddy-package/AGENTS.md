# WorkBuddy 接入 iO Agent

先阅读 README.md。仅操作这个解压包和当前任务，不修改原手机 App、其他电脑登记或其他会话。

1. 先运行 `node setup.mjs doctor`。首次电脑配对由真实会话运行 `node io-agent.mjs pair`，stdin 包含 topic 与实际 workspace。若返回 paired=true，直接复用，不让新会话再次扫码；未配对才向用户展示二维码 HTML 和 pairing_string，手机核对电脑授权范围后保存。不要走登记文件回传/导入流程，不索要其他电脑密钥。
2. 宿主提供真实 `IO_AGENT_CALLER_RUNTIME=workbuddy` 和 `IO_AGENT_CALLER_SESSION`。无法确认真实会话 ID 就说明阻碍，不自行编造 ID。
3. 用 `pair-status`（stdin 为 `{}`）检查手机是否确认；waiting_for_phone 时等同一次配对，不反复建新绑定。paired 后，新会话自动复用电脑授权。可调用一次 `node io-agent.mjs join`，stdin 为 `{"topic":"本次任务主题"}`；首次 ask/notify/checkpoint 也会自动 join。随后调用 config，stdin 为 `{"glasses_progress":false}`。进度推送保持关闭，不执行参考合同里的默认开启要求。
4. 依次 ask、wait，收到答案后继续本会话。一次只问一个问题；pending 继续等原 request_id，不重复建题。看完整原话，不只看选项 ID。
5. 不冒充手机已展示，不把问答成功当作支持远程启动或打断 WorkBuddy。问答凭据过期/会话 ID 缺失等错误如实报告。
6. 不把当前运行产生的凭据、SQLite 日志、连接文件回传到聊天或打进分发 ZIP。
