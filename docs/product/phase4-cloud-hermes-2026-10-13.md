# P41–P44：真实云服务与 Hermes 固定 CLI 联调

日期：2026-10-13（北京时间）。用户明确授予完整服务器操作权限后执行；手机仍断开，本批未操作手机/眼镜，未更新 Excel。

## 本批结果

固定 r2 包已实际发布到腾讯云，随后独立查账确认 `deployed`、运行文件与包哈希一致、服务 active。原 r1 代码目录可回退；数据库保持原 inode/schema 2，不恢复旧数据库。发布细节见[发布记录](./phase4-lifecycle-release-2026-10-12.md)。

真实本地 Hermes 现已通过公网 HTTPS 队列，使用固定问答 CLI 完成原任务提问、等待、答案消费、继续和结果回传。忙时排队、运行中取消、排队取消、取消后处理下一任务、正常重启不重复结果也通过。这是**电脑→实际云服务→电脑运行时的集成验证**；手机角色的委托和答案由电脑测试程序代发，不能据此关闭手机或眼镜端到端验收。

## 代码改动及取消缺陷

新增 `tools/phase1/cloud-test-credentials.py`：通过已有固定主机 SSH 管理接口，为每次独占的 `synthetic-cloud-*` owner 显式签发 phone/agent/operations 三个角色的一小时凭据。没有公开注册接口或自动续签。令牌不进入 argv、日志、报告、仓库，仅经捕获的 SSH 输出写入已限制 ACL 的本地私有目录。撤销按该测试 owner 和 producer 查找，覆盖部分签发、丢回包和已撤销情况；成功后逐个从公网验证401。

新增 `cloud-verification-client.mjs`，只接受本项目私有目录、指定 HTTPS 地址及严格合成 owner 的配置；身份和新能力声明必须吻合。新增 `verify-cloud-queue.mjs` 验证实际公网问题裁决与后台统计。原 `verify-hermes-provider.mjs` 增加显式 `--cloud-config`，共用原模型/路由/回执/进程证据断言；本机队列仍可运行。测试队列访问改为异步，以免把尚未返回的网络 Promise 当成状态。

第一次真实云端取消失败，结果准确保留为 `execution_unknown`。原生账本实际记录：取消请求=true、中断=true、completed=false、进程树已关闭，但 `final_response=None` 使观察器的 valid=false。固定安装版的 `acp_adapter/server.py` 已明确记录中断结果可以没有正文。

修复 `hermes/native_observer.py`：仅在完整布尔标记、interrupted=true、completed=false 时允许空正文作为中断证据；完成仍要求真实有界字符串。取消仍需取消请求、ACP cancelled 响应及进程树关闭共同成立。无响应、无关闭证明、标记缺失或矛盾时继续 unknown，不把空正文转换成成功消息。

第一次失败的任务没有重放、没有改写成成功。保留旧 owner、原生账本和失败报告；用全新的合成 owner 与新登记会话验证修复。

## 已完成的验证

| 范围 | 实际结果与证据 |
| --- | --- |
| 固定包发布 | `io-server-20261012-r2-deploy.json` 及独立 `-deployment-inspection.json` 均 deployed，旧目录保留 |
| 公网 API 与权限 | [5项场景通过](../../rebuild/phase1/cloud-queue-verification-2026-10-13.json)：静态资源逐字节哈希、CSP/no-store、认证限制、任务重复/事件查账、服务器时钟过期一次、迟到答案拒绝、父任务取消中只撤回未答问题、已答优先、角色权限及流量 |
| 调度器回归 | 12项通过，包括真实独立 home 持有进程退出保护；新增 None 中断正文、缺少取消响应/关闭证据保持 unknown，模拟 runner 采用实际中断字段形式 |
| 执行不明对账回归 | 11项通过，[原始日志](../../rebuild/phase1/cloud-hermes-reconciliation-tests-2026-10-13.log)；裁决为合成，不把旧 unknown 自动重新执行 |
| 真实模型云端集成 | [9项场景通过](../../rebuild/phase1/hermes-real-provider-cloud-cancel-2026-10-13.json)，固定 Hermes pin、真实 kimi-k3、独立登记的既有 ACP 会话、固定 CLI，未启用 MCP/办公工具 |
| 实验凭据撤销 | 三个合成 owner 的全部9枚凭据已撤销，每个角色公网 identity=401。issue/revoke 元数据在 `rebuild/phase1/cloud-*-credentials-*.json`，没有 bearer |

真实模型主任务的答案含提交后才生成的 nonce；原 task_id/route 必须匹配，并同时存在独立 task_resumed/task_completed 回执和含该 nonce 的结果。第二个任务先处于 agent_received，随后完成。运行中取消有原生 interrupted=true、completed=false 和 owned_process_tree_closed=true；排队取消未进入模型。原问题同版本撤回且有独立 request 回执，迟到答案被拒绝，取消任务没有成功结果；后续真实模型任务完成。

断网场景是在电脑 bridge 的 fetch 边界注入不可用，真实云端仍在线：失败期间游标不推进、云端任务仍 queued，恢复后使用原账本与真实 HTTPS 补拉。不是物理断网或路由器故障测试。重启场景是结清后正常重启，不是运行中崩溃恢复工具等待栈。

失败报告保留为 [attempt1](../../rebuild/phase1/hermes-real-provider-cloud-cancel-attempt1-2026-10-13.json)，对应旧观察器 SHA。新成功报告保存新源码 SHA，不覆盖旧失败事实。新报告也不证明 `admission_probe_v1` 的真实模型故障注入；该专项仍以此前合成模型集成为证。

## 流量与后台

[公网后台](https://cznbnb.cn/io-api/v1/admin)的页面、脚本和样式与发布包哈希一致；受认证保护的统计 API 已实际使用 operations:read 验证。只读角色不能提交任务，手机角色不能读后台。尚未进行已登录后台的浏览器交互验收。

[真实 Hermes 实验流量](../../rebuild/phase1/cloud-hermes-traffic-2026-10-13.json)区分 cloud-agent 和 cloud-phone。后者是电脑测试驱动，不能称为手机实际流量。统计为 API 请求/响应正文字节，按 owner 隔离，不包括 HTTP/TLS 开销、网站或腾讯云计费总流量。实验约200ms轮询用于及时断言；这不是日常5秒轮询的耗电/流量结论。统计查询自身不累加。

## 复跑与剩余工作

先用新的 run-id 显式 issue，得到 `rebuild/agent-bridge/private/cloud-<run-id>/bundle.json`，按用途分别运行：

```powershell
node tools/phase1/verify-cloud-queue.mjs --run-cloud --config <绝对私有bundle路径>
node tools/phase1/verify-hermes-provider.mjs --run-provider --with-cancellation --cloud-config <另一个全新owner的绝对私有bundle路径>
```

使用实际 Node22 和已准备的固定 Hermes Python。不同实验不要复用 owner；结束或失败后显式 revoke 同一 run-id，若撤销观察不确定，先按原 owner 查账，不能重新签发掩盖。私有测试 home 和合成资料暂保留，未自动清理任何用户资料。

仍待：正式 owner 的电脑/手机路由与凭据登记、手机文字委托与待答页真机、手机后台联网及积压、眼镜选择/语音链、用户既有 CLI/TUI 会话接入、运行中断后原工具栈恢复、答案/取消/关闭投递不明恢复、真实模型问题过期策略、8小时稳定性及功耗、原音归档和官方基础功能全对齐。P43/P44、AC-ASK/AC-VOICE/AC-OFF 保持未验收；公网已可达和这次集成通过均不能替代上述产品验收。
