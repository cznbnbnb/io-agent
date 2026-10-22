# P12 真机后台只读实验

2026-10-11 北京时间约02:16–02:20。用户允许自行操作已取消密码的手机，并已停止需要真人旋钮/头势配合的实验。只启动冷进程 SuggestionLabAbility，未启动日常首页、录音、智记、助手、真实待办或 Agent 执行工具。

## 实验边界与实现

手机实际安装0.1.20 /10020，签名HAP SHA256 `29db1063755287f4d40fcaed362276e94fc4350d2682d48b1d785a7e1979eb7f`。此前0.1.18已恢复过时眼镜连接地址及重启自动重连。本次每轮90秒，沿用同一已认证连接，临时申请系统 `bluetoothInteraction` 后台任务，不改后台保持偏好；每8秒只发送business15原有general status查询，记录实际statusReplies/RX增量。

`BackgroundLabSession` 只写自身脱敏实验记录；`TranscriptionSignals` 读取系统电量、充电、热等级、屏幕活跃与App文件区剩余空间。未知状态保持未知，WARM及以上推迟重任务。候选预算仍未挂接RecordingService，原有充电条件没有删除。

`AsrEngineClient.healthcheck()` 经现有真实AsrWorker排队返回，不加载模型、不读音频。5秒无回应或Worker错误将拒绝挂起请求并结束该线程；关闭后不能再投递，需创建新线程。日常模型加载/识别未据此增加未经测量的短超时。

测试网络为手机127.0.0.1经hdc rport到电脑127.0.0.1临时HTTP服务，每8秒拉取合成短响应。服务150秒自动结束，只处理`/p12`，不访问公网。首轮25–50秒返回503，次轮先无服务造成连接不可达，再启动服务。它验证短时后台HTTP及失败后重新收取的可行性，不是自有服务器推送、消息入箱、去重或离线队列的产品验收。

## 第一轮：熄屏与服务错误恢复

证据：[原始脱敏样本](../../rebuild/phase1/device-background-0.1.20-first.json)、[汇总](../../rebuild/phase1/device-background-first-summary.json)、[临时服务日志](../../rebuild/phase1/device-background-network-fixture.json)。

90秒自动结束，共12个样本，11个同时满足Ability后台、屏幕inactive、系统后台任务active、连接ready。全程statusReplies从2增至13，RX从3031增至7937字节；熄屏区间继续递增，不能仅解释成计时器存活。Worker健康往返首次13ms，后续1–2ms。网络出现3次503对应的`unexpected_response`，随后恢复`fixture_received`。电量100%、持续充电、热等级0，无法从这一记录测算耗电或未充电推理预算。

期限到达后记录`deadline`并释放本轮申请的后台任务；后台不再具备资格时主动停止连接。恢复前台后自动重新连至ready，见[恢复页面状态](../../rebuild/phase1/device-summary-p12-020-resumed.json)。这种行为是明确释放与重新认证，不冒充90秒之外一直保持同一链路。

## 第二轮：连接不可达后恢复

证据：[原始脱敏样本](../../rebuild/phase1/device-background-0.1.20-network-recovery.json)、[汇总](../../rebuild/phase1/device-background-network-recovery-summary.json)、[恢复服务日志](../../rebuild/phase1/device-background-network-fixture-recovery.json)。

90秒自动结束，同样12个样本、11个熄屏后台样本。前3个样本真实连接不可达，随后9个收到有效合成响应；恢复无需打开手机页面或手动重试。状态回包14→25，熄屏区间15→25、RX8829→13289字节；Worker首次4ms，后续1–2ms。电量仍100%、充电、热等级0。两轮合计仅3分钟诊断，不能据此宣称全天收信或积压业务恢复。

## 已知限制与后续修改

最终0.1.21 /10021已覆盖安装，SHA256 `4c6a47d431e55b31f9bb019b0643c13979832423833f3e5a0cdd2d839ed1fcb5`，自动重连ready；该版本进一步按请求Ability的context绑定后台通知。真机短时检查系统任务授予、Worker响应通过，并手动结束，见[样本](../../rebuild/phase1/device-background-0.1.21-smoke.json)和[最终页面](../../rebuild/phase1/device-summary-p12-021-cleaned.json)。未重复完整90秒；两轮熄屏数据明确属于0.1.20。临时HTTP服务已自动退出，18765反向映射删除后核对不存在。

[结束状态](../../rebuild/phase1/device-final-state-0.1.21.json)记录开始实验按钮可用、结束按钮禁用和最近ready连接；随后明确停止本应用隔离进程并熄屏。最终[建议卡记录](../../rebuild/phase1/device-suggestion-final-021.json)无清理义务。没有在用户休息后新发卡或采音。

复现端口规则参考[OpenHarmony官方hdc说明](https://gitee.com/openharmony/docs/blob/master/zh-cn/device-dev/subsystems/subsys-toolchain-hdc-guide.md)。只创建和删除本实验端口；不得重启整个hdc服务影响其他设备工作。

- 当前只证明短时、充电、屏幕关闭状态的只读蓝牙回包、ASR线程排队响应及本机HTTP收取。无密码手机的熄屏不等于带密码锁定的安全状态测试。
- 未采集任何用户声音；真实锁屏采音连续性、双人/重叠说话人准确率、模型推理耗时、未充电/低电/发热/系统回收和15分钟至全天稳定性仍待验。既有录音继续视为用户已验证基础，本轮新增改动后的录音回归尚未做。
- 正式网络收信、耐久入箱/出箱、游标、队列重启恢复尚未实现；临时HTTP实验不能替代P31/P40/P41。
- P20接管生命周期与独立业务状态；P21保护原件并旁车迁移；P22接真实信号、分窗/持久job/checkpoint/退避及重启对账，之后再按实测预算取消必须充电产字的限制。P23使用获授权双人样本验证段内A/B/未知，保留人工修订。
- 后台通知绑定请求它的Ability，防止实验通知误开日常首页；实验仍要求冷进程，不与另一个业务Ability并行运行。结束时释放临时任务与端口，不保留常驻测试服务。
