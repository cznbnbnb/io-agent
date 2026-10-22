# P11 Hermes owner 重启边界补测

固定本机Hermes `0.21.5+9117.g08165d5`，commit `08165d58931841cee713468ae89032af7c57060a`。运行 `tools/phase1/probe-hermes-owner-restart.py`，使用独立HERMES_HOME及探针自有进程；阻断网络，以合成Agent替代模型构造，调用真实session/prompt/server_requests/auto-continue处理。未读取或投递用户工作会话，没有真实工具副作用。

先建立指定会话和基线历史，发合成clarify并等待，忙时追加一条合成消息；实际终止该owner进程，再从同一隔离状态库恢复。结果见[机器记录](../../rebuild/phase1/hermes-owner-restart-probe.json)：

- 旧live session ID被拒绝；stored session保持相同，新live ID生成。历史恢复与原Python等待点恢复必须分开表示。
- 旧runtime_request_id没有恢复，旧答案不接受。
- 默认auto-continue实际重新投递中断prompt，产生一个新问题；向新问题回答后，恢复会话的合成轮次继续。它是新等待点，不是旧问题被原样恢复。
- 原忙时追加消息未执行。源码 `tui_gateway/methods_session.py` 的resume路径会retire未排出的队列行；内存队列不能作为电脑断电恢复保证。

`passed=true`表示探针预期观察成立，不表示原任务无缝恢复或真实模型验收。最初探针抑制模型构造，未等到auto-continue；之后修正为显式合成模型就绪，才得到上述新问题/继续证据，机器记录以修正后运行结果为准。

P40–P44需要持久化 `task_id/request_id/revision → stored_session/runtime_request/qids/gateway_generation`，以及忙时未确认消息/outbox。owner代次变化后先对账：旧等待点失效进入execution_unknown/恢复待核对，不向新活动窗口盲投，也不凭auto-continue描述符确认task_resumed。重新提问时确认与原task的关系、撤回旧输入资格，旧答案不能未经版本核对映射到新问题。运行时auto-continue可重放prompt，适配器须在首次导入任务前选定并验证恢复策略，防止自行重投造成重复执行。

同owner断线再附着、指定会话、问答、忙时追加和取消的既有WS实验仍有效。真实用户gateway/模型/工具、持久连接程序及服务器端到端仍未验；skill只指导工具使用，不替代连接或运行时路由。
