# WorkBuddy 交接与晨间任务

本目录是一份普通 `SKILL.md` 技能包，带 Python 标准库辅助脚本，不依赖 Codex 专用运行工具。`agents/openai.yaml` 仅供 Codex 展示；其他 Agent 直接阅读 `SKILL.md`。本包没有聊天正文、账号 ID、密钥或登录凭据。

## 放到另一台电脑

1. 解压整个 `cz-lifelog-correct` 文件夹到固定目录。让 WorkBuddy 使用其支持的本地技能加载方式；若未配置技能发现，直接要求它读取该文件夹的 `SKILL.md`，再按其中的相对路径读取参考文件。不要只复制入口文件。
2. 确认该电脑已连接同一账号的 `cz-iot-cli`、飞书和微信云端 CLI。用 `help` / `--help`、认证状态和只读查询确认；无需复制另一台机器的凭据文件，不修改既有配对。
3. 保存目标电脑自己的命令位置。微信在 Windows 通常用包内 `.venv\Scripts\python.exe wxcli.py` 或 `wxcli.cmd`；macOS/Linux 通常用 `.venv/bin/python wxcli.py`。这里只是包布局示例，以实机文件为准。
4. 辅助脚本需要 Python 3.10+，无第三方依赖。它只处理本地 JSON，不联网、不调用任何写入接口；由 Agent 审阅证据后执行 `daily-correct`。
5. 把运行快照、消息缓存、证据、复核台账放在独立的持久数据目录，不放技能目录。首次运行可先要求预览；已有明确写回授权则直接完成。

目标机可以保存如下**非机密**配置，路径和账户从实机只读发现中填写；不要填 token：

```json
{
  "source_timezone": "Asia/Shanghai",
  "schedule_local_time": "07:00",
  "cz_command": ["cz-iot-cli"],
  "lark_command": ["lark-cli"],
  "wechat_command": ["目标机微信包内的Python路径", "目标机wxcli.py路径"],
  "wechat_account_id": "从 account list 确认",
  "state_directory": "目标机持久数据目录"
}
```

配置中的命令是 argv 数组，不是拼接 shell 字符串。Windows 的 PowerShell 不支持 Bash 的 `<<` heredoc；执行 JSON stdin 时优先让 Python `subprocess.run(argv, input=json.dumps(payload, ensure_ascii=False), encoding="utf-8", ...)` 传入，避免中文编码和转义错误。

## 升级到 v4

解压新版包，用其中的整个 `cz-lifelog-correct` 文件夹替换 WorkBuddy 当前任务实际加载的同名技能目录。保留技能目录外的运行记录。确认 `SKILL.md` 和同级的 `scripts/`、`references/` 在同一层，避免多套一层目录。运行该目录的 `python scripts/lifelog_review.py --version`，期望输出 `cz-lifelog-correct v4`。独立安装技能时，更新 CLI 和安装技能仍是两步操作。cz-iot-cli 随包附带本技能时，运行 CLI 的 update 会同时更新包内的完整技能；从该 CLI 返回的技能入口读取 SKILL.md 和同级参考文件，无需另行复制。任务提示词或独立安装的其他副本不会自动替换，须确认当前任务实际读取的是随 CLI 更新的这一份。

对以前审过的日期，用新运行目录、当前有效稿和必要历史重新建立事件与断言的对应关系。v2/v3 的快照、直接证据和已核准的文字可继续使用，旧请求只用于还原修改历史。读 [本人归属与录音串场](event-review.md) 与 [CLI 与写回](cli-and-writeback.md)。

## 每日 07:00 提示词

把 [可直接替换的任务提示词](workbuddy-0700.txt) 的全部文字粘贴到已有 WorkBuddy 任务，调度时区选 **Asia/Shanghai**，每天 **07:00**。安装技能与替换任务提示词都要完成，旧任务可能仍带有上一版判断规则。

## 日常速度控制

- 一次取全日智记；先本地分组、查疑点，再查消息。
- 同一事件的一组人名、型号、数量共用证据上下文；文档只读一次。
- 无明显问题的口头语不触发外部查询；关键数字和归属不能为提速跳过。
- 限定会话和时间再分页；达到证据门槛停止。已经确认的改动先完成，不为无法辨认的几句拖住全日。
- 正常采用两轮证据检索；需要第三轮应有具体的新线索。未解决问题明确保留，不假装解决。
- 报告“本轮查证结束”不等于“所有不确定词已还原”。
