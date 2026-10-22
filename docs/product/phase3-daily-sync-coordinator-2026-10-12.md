# P31/P32 日常前台同步接入与真机修订恢复

后续更新：[0.1.48 真实断网积压恢复与逐项查账](./phase3-phone-offline-recovery-2026-10-12.md)。本页保留 0.1.47 当时的验证边界。

日期：2026-10-12 中午。候选 0.1.47 / versionCode 10047 已签名并覆盖安装，未卸载、解绑或清除用户资料。保持原厂固件及已有录音链路。Excel 按用户本次明确要求更新，之后仍仅按请求更新。

## 本次交付

- `MaterialSyncCoordinator` 把资料增量发现、持久 outbox 与 HTTPS 传输串起来。每轮最多检查 32 个修订、生成 8 个信封、处理 4 次发送/对账；空队列不发身份心跳。计时器 1–30 秒，身份错误至少间隔 30 秒。问题版本不会被后续版本越过，过期、冲突与损坏不会自动换发。
- `MaterialSyncService` 由 Ability 生命周期持有，切换页面不销毁队列。前台开始，后台暂停并将已发请求视为不确定，回前台先读配置再恢复。**没有申请后台网络长时任务，也不宣称锁屏上传已支持。**
- 更换目标/禁用/销毁会取消并等待旧请求结束，再建立新账本写入者；晚到回执不能确认另一目标。保险库读取与显式保存有代次隔离，旧读取不能重开已关闭的同步；旧运行时未关闭前不初始化第二个写入者。
- `MaterialSyncSettings` 单独使用 AssetStoreKit 别名 `turboio.material-sync.v1`，保持 DEVICE_UNLOCKED。默认关闭，不从旧 Markdown 上传配置或实验配置导入令牌。锁定/损坏与不存在区分，不以空配置覆盖已有值。令牌不进入日志、启动参数、回执或版本库。
- 智记页加入小范围同步设置、积压与版本状态组件。开启说明明确包含本机历史文字/元数据/删除标记；需保存后生效。没有自动替用户启用真实历史上传，也没有批量改页面视觉。
- `MaterialSyncView` 从当前身份的持久 outbox 推导资料**最新修订**状态。旧版本已存储不代表新版本已同步；只有当前版本回执提供 receipt/commitSeq。immutable `MaterialRevision.sync_state` 的旧 local 字段保留，UI 改读视图；不为回执制造正文修订或改写历史文件。原音状态独立为 not_scheduled。

## 真机和公网证据

独立 `PersistenceLabAbility` 使用 `/p31-material-outbox-lab/coordinated-1791777493049`，只生成合成原文、合成修订和删除标记。没有访问日常资料目录、连接眼镜、收音或执行 Agent 任务。

| 项目 | 结果 |
| --- | --- |
| 手机原生自动发现与真实 HTTPS | 三个不可变版本按序获得真实 server_stored 回执，commit_seq 8、9、10，均 attempts=1 |
| 手机进程重启 | PID 14296 停止后，新 PID 15301 冷启动同一 run_id；三行完整 outbox 与最新视图和重启前逐字段相同，attempts 仍为 1 |
| 当前版本视图 | revision=3、server_stored、commitSeq=10；与删除回执一致，audioState=not_scheduled |
| 原手机身份查账 | 逐一查询三个事件，回执 ID、修订、对象、序号及时间均与手机一致 |
| 独立电脑查询 | get 返回 MATERIAL_DELETED / HTTP 410；changes 返回相同对象 revision=3 的删除事件及 commit_seq=10 |

手机报告为 `rebuild/phase1/device-coordinator-live-2026-10-12.json`、`device-coordinator-resume-2026-10-12.json`；只读公网证据连接器结果为 `phone-coordinator-cloud-verification-2026-10-12.json`。这是**真机合成资料修订/删除/已确认账本冷启动恢复通过**，不是整个 P31/P32 或 AC-QUERY 验收完成。

实验凭据文件已覆盖为无令牌标记，设备 SHA256 校验成功：`9d9a4bcab042a162f26c54ab00292fedcb724d395ab33388d04d8a575c7a9b2b`。仍使用既有有效 phone-harmony，未签发新凭据。手机密码未写入项目或调试日志。

## 组件与构建验证

- App 全量组件回归 554/554，通过时已包含协调器 7 项和保险库 3 项；其后新增实验入口与服务设置并发回归，相关 15/15 通过，包含已有 3 项 live transport、新增 2 项 coordinator phase、4 项 service 与 6 项 launcher。
- 协调器测试覆盖未启用不发现/不发网络、旧回执与新修订、删除、丢 POST 回包后重启先查账、不重投、取消排空后重启同账本、身份不匹配不发正文、前置版本被拒绝后不越过、单轮预算、并发 tick 及真实本机 HTTP/SQLite 接收。
- 原生编译、签名、覆盖安装通过。首次编译发现组件字段 enabled 与 ArkUI 属性冲突，已改为 syncEnabled。存在既有依赖资源冲突、异常处理及高德 sourceMapsPath 警告，本次未把编译成功等同于零警告。
- Excel 已检查历史列迁移、本次数值/百分比、导出重读、视觉、公式扫描、工作表/冻结/表格/筛选/条件格式/原生百分比条保留。

## 尚未验证或未完成

1. 日常主页面配置启用、真实录音/智记历史同步与修订操作尚未做完整真机走查。本次云端均是标注的合成资料。
2. 丢回包、后台暂停、保险库不可读、切换目标及断网恢复已有组件证据；手机真实断网后积压恢复与后台网络租约没有实测。本次冷启动发生在三个回执已完整落盘之后。
3. 原音上传与独立网络策略、凭据轮换、积压/冲突/过期人工恢复界面、账本容量治理和 8 小时功耗仍未完成。outbox 现有限额 1000 行 / 64 MiB，不在本轮暗自清理历史来回收额度。
4. 新配置需先在解锁前台读取，未承诺重启后锁屏可取得 DEVICE_UNLOCKED 凭据。默认关闭保持，下一步不能把实验令牌自动灌入日常设置。
5. 官方 BASE 差距、双人说话人验收、真实 Hermes 模型与云端任务、手机文字委托、眼镜完整问答/语音、多设备和最终替代验收仍未关闭。

## 复跑

使用现有启动器参数 `-Credential rebuild/material-server/private/phone-harmony.json -Producer phone-harmony -Phase coordinator-live`，先停独立实验进程且确认手机已解锁。收取该 run_id 报告；停止进程后 `-Phase coordinator-resume -RunId <同一个13位run_id>`，收取第二份报告，再运行：

```
node tools/phase1/verify-phone-coordinator.mjs <live-report> <resume-report> <output-json>
```

凭据只读私有文件，不能填进 argv 或输出。该验证器固定 phone-harmony 及既有查询配置，超过 10 页变更会保守失败。实验结束覆盖固定实验配置为无令牌标记并核验，不删除用户目录。保留失败报告，禁止覆盖成成功。
