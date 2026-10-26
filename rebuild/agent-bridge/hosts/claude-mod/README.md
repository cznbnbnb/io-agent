# Claude 原会话 Mod 候选

这是电脑端隔离验证候选，尚未接手机分派或安装进现有 Claude Desktop。它通过官方 Mod 的后台定时器读取本机受认证队列，在加载 Mod 的真实 Claude session 内调用 `$.prompt.submit` 和精确 `$.turn.abort({turnId})`。不是另起 `resume` 进程，也不读取桌面内部凭据。

## 接口与临时加载

```js
import {createClaudeModBroker} from './broker.mjs';

const broker = await createClaudeModBroker({
  directory: privateDirectory, // 绝对路径，目录权限必须为 0700
  binding: {
    server_id, owner_id, host_kind: 'claude', workspace: actualCwd,
    route: {computer_id, agent_id, project_id, session_id: actualSessionUuid}
  }
});
// broker.host 交给 SessionControl；用 broker.pluginDirectory 临时加载插件。
// 不输出或复制 broker.configFile 的私有令牌。
// 测试结束：await broker.close();
```

broker 将插件复制到私有目录，写入 `.claude-plugin/connection.json`（0600）。它只监听 `127.0.0.1` 随机端口，`/v1/bind`、`/v1/poll`、`/v1/report`、`/v1/child-report`、`/v1/end` 均要求私有 Bearer token、精确 session/cwd 和本次 Mod instance。浏览器 Origin 请求拒绝。此令牌仅允许控制明确配对的本机原会话，不是服务器或 Claude 账号凭据。

隔离真实 CLI 验证由主任务执行；先创建 broker，再在相同 cwd 中以**指定新隔离 session UUID**启动临时插件，保留 stdin 和进程：

```sh
"$CLAUDE_BINARY" --session-id "$ISOLATED_SESSION_UUID" \
  --plugin-dir "$PRIVATE_PLUGIN_DIRECTORY" \
  --input-format stream-json --output-format stream-json --verbose -p
```

这里的隔离测试会话仅用于验证宿主协议，不能称作接管了既有桌面聊天。正式对已有 Desktop 原会话接入必须由用户授权安装、在原会话重载插件，并核对其实际 session/cwd；本候选没有自动安装命令，不更改全局配置。插件重新载入产生新 instance 时，旧 broker 拒绝重复绑定；需明确结束旧绑定并重新建配对，不默默复用未知执行状态。

## 执行合同

- `atomic_queue_append:true`、`atomic_idle_start:false`。原生 `prompt.submit` 等待宿主空闲；Mod 初始状态为未知忙碌，不靠一次快照假造空闲。原生 Promise 只表明准入结果，完成必须关联本操作的 `turn.start`/`turn.complete`。
- 队列按顺序发送一个输入。每条输入先在 broker 和 Mod store 写入操作 ID，再跨宿主边界。HTTP 回复丢失可重取同一操作，但 native submit/abort 不重发。重启或发送不明会阻塞后续输入，不能以没查到历史推断未执行。
- 任务含期限；broker 交接前及 Mod 真正调用 native submit 前检查。**`native_queue_expiry:false`：本候选不保证进入原生队列后、开始执行时仍未过期。** 实测自调用会跳过自身 `prompt.submit` hook，所以旧版声称的二次准入截止不成立；不能据此满足严格执行截止的产品合同，需主任务决定后续方案。
- 操作标记以认证 broker 的派发记录、已写入账本的操作 ID、RAM 中明确已调用 native submit 的待发全文及精确 session/cwd 共同绑定。`turn.start` 仅接受全文或真实 2.1.308 运行观察到的完整固定归属说明，不能搜索消息内部标记。其它来源在 `prompt.submit` 中使用保留标记或本插件归属说明时拒绝；普通无关用户轮次不消耗真正排队的操作。此 hook 用来拒绝外部伪造，不用于证明自身派发。
- 停止请求可越过等待空闲的输入，但只调用当前精确 turn。原生用户 Stop gate 的 `drop` 如实返回，插件不清除 gate。`abort_requested` 仅为请求回执；`inspectStop().descendantsStopped` 始终为 false，真实子任务退出尚需独立证据。
- 实测 2.1.308 的 turn abort 会把运行中的 Bash 转到后台。候选补层在 `tool.call{tool:'Bash'}` 中，将原生 `tool_use_id` 绑定到已认证操作的精确 turn，先耐久记账，再调用 `next(e)`。只有原生结构化结果含 `backgroundTaskId` 和 `backgroundedByTurnAbort:true`，且本 Mod 确已向该 turn 派发 abort，后台 pump 才以精确 ID 调用 `$.tool.call({tool:'TaskStop',task_id})`。不从工具文字提取 ID，不停止子 Agent、用户普通后台任务或其它轮次。
- TaskStop 前耐久保存 `stop_prepared`，沿用 Claude 原有工具权限检查，不批准权限。明确成功记 `stop_requested/native_result:success`；权限拒绝、结果结构不符、异常及重启时无法证明完成均单独记账，不自动重发。`inspectStop().childStops` 只返回工具 ID、原生任务 ID、turn ID、阶段和简短结果原因，不返回命令或工具全文。即使 TaskStop 成功，也不据此宣称全部系统子进程已退出。
- 宿主调用方必须等待精确轮次终态和独立的受控子任务停止证据，才可继续；broker 的 `interrupted` 不是全部子任务已停止的准入许可。SessionControl 保持此门禁，隔离 runner 另验自己创建的 OS 子进程。生产通用退出证据仍未实现。
- `session.end`、实际 session/cwd 改变、持久化失败都停止派发。旧会话未回执输入为 unknown；确定未发的队列被丢弃。不会绑定到 `/clear`、`/resume` 或 `/branch` 后的新会话。
- `final_result_evidence:true`：`inspectOperation()` 仅在收到本轮 `turn.complete` 的完整最终文本后返回 `resultComplete:true` 和 `{type:'text',text}`，明确的空字符串也算完整结果。缺少 answer 或超出候选 32768 字符上限时保留真实完成态，但 `resultComplete:false`，供控制器进入 `result_pending`；不伪造空结果或静默截断。非完成态和结果不明也不标完整。排队没有 turnId，不生成假轮次。未准入便拒绝/到期返回 `status:'rejected'`，无法确定的结果返回 `found:false,outcomeUnknown:true`。

Mod 不引用 Node 模块，只使用官方 `$` API 和同目录纯函数。回执按顺序持久化，避免后台 pump 与事件回调并发写入覆盖后来的终态。账本上限 1000 条，满时明确拒绝；生产清理/保留政策未加入本候选。

## 验证及边界

```sh
node --test rebuild/agent-bridge/tests/claude-mod.test.mjs
"$CLAUDE_BINARY" plugin validate rebuild/agent-bridge/hosts/claude-mod/plugin --json
```

合成测试使用假 `$` 宿主和真实隔离 loopback HTTP，按实测模拟自调用跳过自身 prompt hook，覆盖认证、精确绑定、忙时队列、提交前期限、排队后期限的明确缺口、丢回执、幂等、独立 abort、Stop gate、旧 callback、重启、写盘失败和终态保护。专门覆盖 abort 转后台、结构化原生任务归属、权限拒绝、停止意图写入失败和未知停止不重发，当前 28 项通过。内嵌 Claude Code 2.1.308 静态 validator 接受 manifest、六个事件和 API 调用；本地候选未提供分发图标。合成及静态检查不证明真实原进程或 Desktop 已接通。

主任务第五次隔离真实运行已通过：原 session 空闲唤醒、nonce/上下文保持、精确 turn 关联和完成回执；加入 TaskStop 补层后，受控 Python 在运行 1.429 秒时退出（原自然期限 120 秒），心跳静止 1 秒并有 SIGTERM 标记；随后同一个 session 再次接收远程输入并正确回读原 nonce。临时引擎、受控子进程、broker 均已收尾。此次停止快照取得较早，仅记录 `stop_prepared`，不据此补造成功回执；OS 退出证据独立成立且只涵盖这一个受控 Python。隔离私有报告为 `/tmp/io-claude-mod-proof-20261025-v5.json`，生产 `descendantsStopped` 仍为 false。

历史第四次原生 abort 将 Bash 转后台，15 秒内受控子进程未退出，没有算停止通过；第五次是增加精确 TaskStop 后的验证。第三次确认的自调用跳过自身 prompt hook、主 turn 的 agentId 缺省及完整固定 wrapper 已纳入回归。用户在原界面触发的 Stop gate、Desktop 重载流程和界面显示仍须单独验证，不能从 CLI 成功推定 Desktop 验收完成。

官方依据：[Mods 概览](https://code.claude.com/docs/en/plugins/mods/overview)、[后台 API 与队列](https://code.claude.com/docs/en/plugins/mods/api)、[API reference](https://code.claude.com/docs/en/plugins/mods/reference)、[事件](https://code.claude.com/docs/en/plugins/mods/events)、[插件结构与校验](https://code.claude.com/docs/en/plugins/mods/create)。文档列出 Desktop 最低 2.1.286、终端最低 2.1.287；本次静态核对使用内嵌 2.1.308，不把文档支持等同本机真实验收。
