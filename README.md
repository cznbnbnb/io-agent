# iO Agent · cz-iot-cli

基于固定版本 Turbo-IO 与官方 Android App 宿主，开发眼镜、手机、服务器与电脑 Agent 的任务及资料闭环。当前采用 Android 优先路线，保留鸿蒙源码，待 Android 成熟后适配。

## 产品与入口

手机 App 名称为 **iO Agent**；电脑端 CLI 正式名称为 **cz-iot-cli**，支持 Claude、Codex 和其他能够执行命令的 Agent。配对一次后可投送眼镜消息、问答、读取已同步的每日 AI 总结，并建议待办（点头确认后添加）。

便携包入口与跨电脑使用见 [cz-iot-cli 使用说明](tools/collab/workbuddy-package/README.md)。旧 `io-agent.mjs` 调用继续兼容，现有配对、会话和本机资料不因改名迁移。当前功能与装机版本以 [协作交接](docs/product/COLLABORATION-HANDOFF.md) 顶部为准，不在此重复维护旧进度百分比。

当前 Android 仍复用固定原厂宿主的登录、蓝牙、智记与待办能力；独立产品命名不等于这些依赖已经移除。Android 安装身份保留以支持原地更新，原厂内置页面与第三方来源说明按实际保留。

先阅读 [协作交接](docs/product/COLLABORATION-HANDOFF.md)、[开发状态](docs/product/DEVELOPMENT-STATUS.md)、[开发计划](docs/product/DEVELOPMENT-PLAN.md) 和 [项目约定](AGENTS.md)。需求以 [PRD](docs/product/PRD.md) 为准，人工观察统一登记到 [验收清单](docs/product/USER-VERIFICATION-TODO.md)。

## 目录

| 路径 | 内容 |
| --- | --- |
| `rebuild/android-app/src/com/turboio/addon/` | Android 业务、宿主适配、任务与资料运行时 |
| `rebuild/android-app/upstream/` | 固定上游参考，保持只读；提交及文件摘要见同级来源锁 |
| `tools/android/` | Android 构建、签名、定向测试及受控设备诊断 |
| `rebuild/agent-bridge/` | 电脑任务桥、cz-iot-cli、Agent 适配与测试 |
| `rebuild/material-server/` | 资料及任务服务、查询接口、部署配置与测试 |
| `docs/contracts/` | 共享协议与合成样例 |
| `rebuild/harmony-sdk/` | 保留的鸿蒙工程与测试 |
| `tools/phase1/`、`rebuild/phase1/` | 既有设备工具与鸿蒙构建入口 |

## 开发验证

Windows 需要 Node.js 22、Python 3 和 JDK 17。Android 构建另需 SDK 36 / build-tools 36.0.0 与固定 apktool；入口见 [Android 构建说明](rebuild/android-app/README.md)。

以下测试使用合成输入，不操作手机或公网：

```powershell
node tools/android/test-lifelog-calendar-core.mjs
node tools/android/test-lifelog-calendar-http.mjs
node tools/android/test-lifelog-month-discovery.mjs
node tools/android/test-material-month-runtime.mjs
node tools/android/test-context-voice-fixture.mjs
```

传输测试包含一次真实 30 秒的本机截止等待，HTTPS 端口仍为测试替身。其他测试命令及分工见协作交接。手机诊断脚本不是离线测试，不应在新环境直接批量执行。

## 本地依赖和数据

GitHub 只保存可审查的代码、协议、测试和进度。官方宿主 APK、固定自有签名、真实账号凭据、原音、智记正文、设备身份、工具缓存与历史原始日志保留在本地，不进入仓库。没有这些私有输入仍可推进纯核心、服务器和模拟测试；完整装包及真机验收由持有相应环境的开发者完成。

官方宿主固定为 **1.0.7 / 230**，SHA-256 为 `30239f65d910cf7008cfdf6cfacd5c068c5877068b4a637027786377a9ce4f91`。不要用其他官方版本替换输入来跳过 ABI 或来源门禁。不要为绕过签名冲突卸载 App 或清数据。

## 来源及许可

Turbo-IO 固定提交为 `f57cc82d0c810435653b684fbdd8c07c533a012f`，原始选取文件与摘要保留于 `rebuild/android-app/upstream-source-manifest.json`。当前上游使用 [PolyForm Noncommercial 1.0.0](rebuild/android-app/upstream/LICENSE)，另保留 [NOTICE](rebuild/android-app/upstream/NOTICE) 及 [第三方说明](rebuild/android-app/upstream/THIRD_PARTY_NOTICES.md)。私有托管不改变相应许可要求，本仓库不将整体重新标为 MIT。

本次为协作建立独立 Git 基线；本地早期开发历史及未公开的原始证据继续保留。部分历史文档链接指向仅存本地的证据，不能把链接缺失当作该功能已通过或已失败。
