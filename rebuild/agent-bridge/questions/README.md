# 当前调用方的原任务问答

`cli.mjs ask|wait|status`复用现有HTTPS队列、bridge、运行锁、耐久outbox和QuestionTools。当前Codex用实际执行环境中的对话标识登记，问题与答案固定绑定原任务、项目、会话和问题版本；不调用Codex启动/恢复命令，也不创建替代模型会话。Hermes原有固定CLI和适配器保持，两个入口复用相同问题状态机。

## 宿主登记

宿主准备私有JSON文件，字段为`bridge / project_id / operation_key / python`。`bridge`沿用电脑连接配置，额外需要`tasks:write`以创建原调用的任务镜像；`python`是绝对解释器路径。调用：

```powershell
& D:/openclaw/nodejs/node.exe rebuild/agent-bridge/questions/cli.mjs register --config <私有登记文件>
```

命令须从本项目工作目录、原Codex执行环境运行。当前桌面构建实际提供`CODEX_THREAD_ID`；本批另以Codex应用的聊天清单核对了当前项目/会话。缺失或不匹配时拒绝，不能选“最近会话”兜底。这是当前宿主适配边界，不把未查证的环境变量行为当作跨版本稳定API。

登记写入受限ACL的`private/codex-*/registrations/*`，先保存不可变镜像事件再发送，未知回包只核对原事件。重复登记使用原任务；更换身份/操作产生独立记录，旧记录保留，存在待答或未消费答案时拒绝切换。登记不分发办公指令，适配器只接管精确匹配的原调用任务。

## 调用

JSON参数走stdin，UTF-8 JSON结果走stdout。配套说明已安装为`turboio-ask-user`；完整参数及恢复规则以[skill](../skill/turboio-ask-user/SKILL.md)为准。

- `ask`：`question_key, question, mode, options, expires_at`。同问题重试保持所有参数。问题先落盘；`server_stored=true`须经实际服务器核对。
- `wait`：`request_id`及可选`wait_seconds`（0–30）。原请求有完整答案且原任务新鲜有效时消费一次，保留唯一继续事实。已成功领取的同一答案可离线重读，不重复继续或执行。
- `status`：只接受`request_id`，只读本机，明确`network_checked=false`；不会消费答案或建立联网状态承诺。

`awaiting_parent_check`保留完整答案但不授权继续；`operation_closed`禁止继续旧任务。失联、撤回和消失均不推定用户拒绝；`cancel_requested`仅记录停止请求，不表示已强制停止Codex。网络不可用时原问题/答案及待发事件保留，不以新问题绕过不确定状态。

## 证据与边界

本批通过9项Python检查和一个实际CLI/真实本地服务器/bridge集成场景，含重复、离线、只读、关闭父任务和待答禁止换登记。当前Codex也已亲自完成公网→真实红米正常答案页→同一CLI原调用的合成两行文字回传；输入由代理完成，不当作真人决策或眼镜效果。[证据](../../android-app/current-codex-text-2026-10-20.json)。

全局skill仅安装本项目调用说明，按[官方技能说明](https://learn.chatgpt.com/docs/build-skills)组织。没有修改Codex启动配置、hook或MCP。正式长期凭据/续期、手机多路上下文、眼镜原请求卡、完整口述及后台日常仍待后续。任务镜像记录最近的接收/继续事实，不提供Codex进程存活监控或强停能力，也不因工具结束虚报任务完成。
