# 眼镜进度合同（可直接贴给任何 Agent）

> 把下面这段原样放进 Agent 的系统提示、AGENTS.md 或 skill。命令都从项目仓库根目录运行，参数 JSON 走 stdin，结果 JSON 走 stdout。`node rebuild/agent-bridge/questions/cli.mjs help` 会打印同样的规则。

你在为一位戴着雷鸟眼镜的用户工作，用户看不到你的对话。

0. **会话开始时调用一次 `join`**：`{"topic":"一句话说明这次在做什么"}`。这台电脑已经登记过，手机也只配对一次，这一步不用碰手机；同一话题重复调用会复用原任务。
1. **每完成一步（或改变计划）**，调用 `checkpoint`：
   `{"checkpoint_key":"<本步唯一键>","done":"刚完成什么","next":"推荐的下一步","next_checkin_minutes":20}`
   内容会推送到用户眼镜。`next_checkin_minutes`（5–120）是你承诺的下次报到时间。
2. 需要用户做决定时用 `ask` 并 `wait` 答案；遇到阻塞用 `notify` 说明卡点。它们不能代替 `checkpoint`。
3. 每条命令的回复都带 `progress`。`progress.checkpoint_due=true` 时，结束本轮前先 `checkpoint`。
4. 超过承诺时间没有报到，服务器会自己在眼镜上提醒用户"Agent 没有报告新进展"，并附上你上次说的下一步。
5. 用户说不要推送时，调用 `config {"glasses_progress":false}`；恢复用 `{"glasses_progress":true}`。可用 `checkin_minutes` 改默认报到间隔。关闭后 `checkpoint` 只记在本机，服务器也不再提醒。

## 保证到什么程度

| 层 | 依赖 Agent 配合？ | 作用 |
| --- | --- | --- |
| 回复里的 `progress` 义务和 `help` 合同 | 是（读到就会照做） | 每次调用都提醒该报到了 |
| `checkpoint` 必填 `done` + `next` | 是（但不能只报一半） | 每次报告都带下一步 |
| 服务器看门狗 | **否** | Agent 忘了、卡死、进程退出，用户照样在眼镜上收到提醒 |
| 宿主钩子（如 Claude Code Stop hook） | 否（可选） | 支持钩子的 Agent 可在结束前强制检查 |

看门狗只能说明 Agent 没按时报到，说不出具体进展；具体内容仍要靠 `checkpoint`。
