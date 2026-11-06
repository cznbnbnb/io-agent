# iO Agent

让电脑上的 AI 助手把问题发到眼镜上。比如 Codex 整理会议记录时需要你选一种格式，它可以在镜片上列出选项。你读完后长按退出、说出答案、点头确认，Codex 就能在刚才那条会话里按你的选择继续。手机也可以查看任务和回复。

**[CLI 接入指南](https://github.com/cznbnbnb/io-agent/blob/codex/agent-workspace-ui/docs/CLI-QUICKSTART.md)** · **[下载 cz-iot-cli 便携包](https://raw.githubusercontent.com/cznbnbnb/io-agent/refs/heads/codex/agent-workspace-ui/docs/distribution/cz-iot-cli.zip)** · [校验文件](https://github.com/cznbnbnb/io-agent/blob/codex/agent-workspace-ui/docs/distribution/SHA256SUMS) · [当前适配源码](https://github.com/cznbnbnb/io-agent/tree/codex/agent-workspace-ui)

## 能用它做什么

| 场景 | 用法 |
| --- | --- |
| 让 Agent 主动联系你 | 用 `notify` 发一条提醒。需要你做决定时，用 `ask` 提问，再用 `wait` 取回同一道题的答案。 |
| 从手机继续工作 | 手机按工作区整理会话。支持远程控制的 Codex、Claude Code 会话可以接收任务及打断指令。用 `session-status` 查看当前会话的实际能力。 |
| 让 Agent 回顾日常 | 配对后用 `daily` 查询已同步的每日总结、分段智记和带说话人标注的转写。Agent 可以根据已有证据订正文字，后续查询读取生效版本。 |
| 把建议变成待办 | Agent 用 `todo-add` 在镜片上提出建议。你点头确认后，它才加入原厂待办。 |
| 在手机整理资料 | 普通录音和全天智记按时间排列。可以按标题和时间导出 MP3 到手机，单戴一只耳机也能听到双方。 |

## 接入你的第一个 Agent

需要一副已连接手机的雷鸟 iO 眼镜、已配置服务的 **iO Agent Android App**，以及能执行本地命令的电脑 Agent。电脑准备 Node.js 22.18+（22.x）和 Python 3.10+（带 sqlite3）。电脑和手机都能联网即可。

1. 下载上方 ZIP，将它解压到电脑上的独立目录。让 Agent 在**要使用的那条真实会话**中进入解压后的 `cz-iot-cli` 目录，检查环境和命令。

   ```sh
   node setup.mjs doctor
   node cz-iot-cli.mjs help
   ```

2. 让 Agent 执行 `node cz-iot-cli.mjs pair`，通过标准输入传入主题和实际工作区。手机打开 **设置 → 电脑与 Agent → 添加/扫码绑定**，扫描二维码或粘贴配对字符串，核对工作区后点「保存并绑定」。同一台电脑的后续会话可复用配对。
3. 让 Agent 用 `pair-status` 核对绑定，再用 `join` 登记当前会话。戴好眼镜后，可以直接对它说「在眼镜上问我一道选择题，等我回答再继续」。服务端接受消息后，Agent 用同一个请求 ID 等到你的答案，就完成了双向测试。

**转发给另一个 Agent** 时，发 [CLI 接入指南](https://github.com/cznbnbnb/io-agent/blob/codex/agent-workspace-ui/docs/CLI-QUICKSTART.md) 即可。指南包含 Windows PowerShell 的中文编码设置、配对输入示例和回执判断。WorkBuddy 等可执行命令的宿主可以主动提问并读取答案，从手机唤醒或打断原会话则取决于宿主适配。

已安装的便携包可以通过 Git HTTPS 检查或更新，配对可以继续使用。

```sh
node cz-iot-cli.mjs update --check --https
node cz-iot-cli.mjs update --https
```

## 系统怎么连接

```text
电脑上的 Agent ⇄ cz-iot-cli ⇄ 任务与资料服务 ⇄ iO Agent Android ⇄ 蓝牙眼镜
```

服务器把问题、答案和回执关联到原任务。手机负责眼镜显示、口述确认，以及用户开启的资料同步。CLI 可查询已同步的文字，MP3 从手机导出。仓库可以公开下载，访问个人设备和资料另需手机批准配对。

## 开发与许可

- [Android 应用与构建说明](https://github.com/cznbnbnb/io-agent/tree/codex/agent-workspace-ui/rebuild/android-app) · [Agent 适配与 CLI](https://github.com/cznbnbnb/io-agent/tree/codex/agent-workspace-ui/rebuild/agent-bridge) · [任务与资料服务](https://github.com/cznbnbnb/io-agent/tree/codex/agent-workspace-ui/rebuild/material-server) · [接口与合成样例](https://github.com/cznbnbnb/io-agent/tree/codex/agent-workspace-ui/docs/contracts)
- 当前实现以 Android 为主，仓库另有[鸿蒙实验工程](https://github.com/cznbnbnb/io-agent/tree/codex/agent-workspace-ui/rebuild/harmony-sdk)。Android 完整构建使用指定版本的原厂宿主 APK 和开发者自己的签名材料。CLI 可独立运行。
- iO Agent 是独立社区项目。仓库保留 Turbo-IO 上游的 [PolyForm Noncommercial 1.0.0 许可](rebuild/android-app/upstream/LICENSE)、[版权声明](rebuild/android-app/upstream/NOTICE)和[第三方许可说明](rebuild/android-app/upstream/THIRD_PARTY_NOTICES.md)。使用对应组件时请遵循其许可。
