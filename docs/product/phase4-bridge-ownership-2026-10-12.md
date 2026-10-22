# P41 运行所有权与停机顺序

承接 `689491c` 的[质量复审](./phase4-code-quality-review-2026-10-12.md)。本批继续修复“两个连接器各自读取账本并执行”与同实例重入风险；不改变 PRD、官方基础底线或开发顺序。Excel 不更新，线上服务及手机安装包不变。

## 实现

- 新增 `rebuild/agent-bridge/run-lock.mjs`，用 Node 22 内置 SQLite 的 `BEGIN EXCLUSIVE` 持有 OS 文件锁；不以 PID 是否存在、锁文件年龄或心跳超时推断可接管。
- 两道锁：规范化账本路径对应的私有侧库；同一 OS 账户 home 下按 server/owner/computer/agent 散列的共享私有侧库。换账本、工作目录或 producer 标签不能绕过同运行时所有权。Windows 规范化路径大小写；已存在路径解析真实路径；硬链接账本拒绝。
- 竞争者 `BRIDGE_IN_USE`，启动器不抢锁、不删除侧库、不启动适配器、不保存账本。身份/scope 或适配器启动失败清理本实例持有的资源；非本组件侧库拒绝并保留。
- `start/pollOnce/flush` 拒绝并发，返回可重试 `BRIDGE_BUSY`；`stop` 拒绝新工作、等待现有操作完成，再等待适配器确认退出，最后释放锁。CLI 已改为桥接器统一管理启动和退出。
- 适配器 stop 必须收到进程退出确认；请求 SIGTERM 后必要时请求 SIGKILL，仍未确认则 `ADAPTER_STOP_FAILED`，不能只因发过 kill 就释放运行所有权。
- 桥接器所持账本的每次保存都校验原运行锁；保留的旧 state 引用在 stop 后不能写回，也不能借用后来新运行的锁覆盖账本。
- 硬退出由 OS 释放锁，保留侧库。prepared 交付仍是 `DISPATCH_UNCERTAIN`，没有自动删除记录、默认重投或假称恢复原任务。

嵌入使用必须 `try { await bridge.start(); ... } finally { await bridge.stop(); }`。`status` 保持纯本地只读，不创建侧库，不启动 SQLite，也不据此宣称在线。不要人工删除正在使用的锁侧库。

## 实际验证

本机 Windows + Node 22.23.2，真实本地文件系统、临时 SQLite/HTTP、合成任务及自有测试子进程：

| 场景 | 结果 |
| --- | --- |
| 两个独立进程抢同一账本 | 第二进程 BRIDGE_IN_USE，第一进程仍持锁；正常释放后接班成功 |
| 持锁进程被 SIGKILL | 等到实际 exit 后新进程获取所有权成功；不删侧库、不猜 PID |
| 换账本/producer 抢同一运行时 | 第二进程仍被拒；不同 Agent 独立运行不受影响 |
| 路径别名、硬链接与外来侧库 | 路径别名同锁；硬链接拒绝；外来文件原字节保留 |
| 连接器抢占启动 | 第二个适配器启动次数为 0，账本字节不变；首实例停止后可启动 |
| 并发 poll/flush/start | BRIDGE_BUSY，没有二次调用运行时 |
| 正在交付时停止 | 等当前交付完成；期间后继仍拿不到锁；停止后可接班 |
| 适配器启动失败或慢停机 | 失败正确清理；慢停机期间锁保留到 stop 完成 |
| 真实子进程在合成副作用后退出 | 新进程可拿锁，但 prepared 记录阻止重新交付；效果标记仍只有一次 |
| 旧账本引用写回 | 原运行停止后 LOCK_LOST；后继已启动时仍不能写回 |
| 真实适配器进程停机 | stop 返回后对该测试 PID 的 signal 0 检查为 ESRCH |

完整桥接回归 **42/42**：bridge 28、adapter-host 6、CLI 3、run-lock 5。证据和源码哈希：[result.json](../../rebuild/agent-bridge/verification/result.json)、[tests.tap](../../rebuild/agent-bridge/verification/tests.tap)。

## 剩余边界

这里只关闭 Windows、本地文件系统、同一 OS 用户的本机连接程序所有权门槛。Linux/macOS、网络文件系统、跨 OS 用户和远程多电脑租约未验证；不是分布式 exactly-once。自定义适配器必须提供有界的启动/停机，真实运行时的子孙进程和既有会话所有权仍需 P42 定义。

P42 尚未完成：需要真实 Hermes 指定会话接口、异步问题/任务事件通道、操作 ID 对账、忙时追加及取消；P44 需要期限裁决和不明结果恢复。既有 owner 重启研究仍有效，不能用 auto-continue 重新投递 prompt 冒充原任务等待点恢复。
