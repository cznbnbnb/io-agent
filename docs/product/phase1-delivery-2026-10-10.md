# 第一批实际交付与验收边界

**截至10月11日02:25后的权威汇总：[第一批交付汇总](./phase1-closeout-2026-10-11.md)。手机已安装0.1.21并自动重连ready，最新应用模拟回归378项/契约5项通过；0.1.20新增两轮90秒熄屏只读蓝牙、Worker和本机HTTP失败恢复实测。以下0.1.16–0.1.19及360/369项为各时点历史记录，包另行保留，不代表当前安装版本。**

01:58时点状态（2026-10-11）：手机当时为0.1.18 /10018。新地址经原peer核对、认证和状态回读后保存，重启后自动重连ready，连接回归已恢复。用户真机确认自定义标题/正文、旋转改变添加/删除焦点、短按提交当前项、点头固定添加、摇头固定删除；实际收到type34 cmd1/2，type35 code0提交通过，动画未观察。剩余卡60秒超时后提交移除，清理义务为空；已按用户要求停止重复动作测试。详见[设备结果](./phase1-device-observations-2026-10-11.md)和[连接恢复证据](./phase1-connection-regression-2026-10-11.md)。

02:02时点源码0.1.19仅调整隔离实验回执后保留动画观察期，369项应用模拟回归和5项契约检查通过，原生编译成功，候选未安装；手机不再为重复测试升级。下表0.1.16与360项为当时历史结果，最新构建/测试日志已更新，旧包另行保留。

依据 PRD v0.3 / DEVELOPMENT-PLAN v1.0，保留官方基础体验完整对齐门槛。本批已有代码、契约和设计产物；P10的二态输入已得实测结论，动画、任意多选/按钮自定义和实验后录音回归未验。P12锁屏/功耗/说话人、P11真实模型及owner重启恢复仍待验，不能称为第一批产品验收全部完成。

## 交付索引

1. [P00–P02 基线、BASE-01–10 差距与复用清单](./phase1-baseline-2026-10-10.md)。修改前 Git 提交 `149cbbc` 保存其他 Agent 已有工作；主源码已是 0.1.16 / 10016，手机只读核对安装的是 0.1.15 / 10015，旧报告与包版本差异均保留。
2. [P10–P12 能力、证据与待测表](./phase1-capabilities-2026-10-10.md)。既有录音和设置作为复用基础，本轮未重写；锁屏、原厂旋钮与头势不以函数名或模拟代替真机。
3. [P14 三组最小契约](../contracts/README.md)、[JSON Schema](../contracts/event-v1.schema.json)及同目录正常、重复、过期、离线恢复样例。服务器保存、眼镜显示、用户回答、Agent 接收、原任务继续和完成分别表示。
4. [P13 设计说明](./phase1-design-review.md)、[四页交互草案](./phase1-design-review.html)。涵盖窄宽屏、浅深色、加载/离线/错误，合成预览已在本机浏览器检查宽屏深色请求页、选项和离线提示。原生页面批量修改待评审。
5. [P20–P25 具体修改范围与依赖](./phase1-next-batch.md)。优先生命周期、兼容旁车资料和持续转写队列；硬件/权限未知只阻塞相关项。

## 实际代码与可观察行为

- SuggestionTestSession / SuggestionTestPanel：从“功能→文字通知”进入原厂建议卡实验，合成 UID、60 秒期限、type33/34/35 分流、同眼镜与代次过滤、重复冲突处理、首次回执意图锁定、持久化清理和手动重试。未连业务22待办或 Agent 工具；不会把普通通知 type4 当答案。标题16/正文48是本次实验边界，不宣称固件上限。另增 SuggestionLabAbility 专用入口，冷进程下不加载日常资料处理；真机实验优先使用它，不能从已运行的日常入口切入冒充隔离。记录见[10月11日真机观察](./phase1-device-observations-2026-10-11.md)。
- AppRuntime / NotificationService / NotificationPanel：最小挂接、私有记录初始化和断连释放；保留原有录音、设置、语音与智记代码。实验默认拒绝在录音/智记或其他显示任务中发卡，共存能力另测。
- TranscriptionBudget：新增可测试的电量/热/后台资格/存储/Worker 预算策略；**未接入日常调度**。现有充电门槛没有简单删除。持续转写需 P20–P22 的持久队列、短窗、合法后台资格和实测阈值。
- tools/phase1/probe-hermes.py：使用本机固定版本真实会话 handler 和 server_requests，隔离 HERMES_HOME、合成 Agent、禁外部网络，验证指定会话/等待/答案继续/忙队列/重新附着/取消。不是常驻连接程序，也不是生产运行时适配器。
- tools/phase1/contracts.test.mjs：Schema 与内存参考状态机验证；真实服务鉴权、数据库事务、耐久 outbox 和部署尚未实现。

## 验证等级与证据

| 等级 | 结果 | 证据 |
| --- | --- | --- |
| 代码/原生编译 | 候选 0.1.16 未签名 HAP 构建成功；原有 API/依赖告警保留 | rebuild/phase1/candidate-build.log；artifacts/entry-default-unsigned.hap；未签名、未安装 |
| 本地开发签名与覆盖安装 | 另生成签名候选包，10月11日00:27前后覆盖安装成功；证书与密钥留原位 | candidate-sign.log、device-install.log；artifacts/entry-default-signed.hap，SHA256 5cbcf6100481e7ffbc1412505c02151cab7a63ebcb372a858a95ad9bfc298637；签名/安装本身不是功能验收 |
| 离线回归 | 修改前346项；修改后360项通过，含建议卡失败恢复、预算和专用入口隔离边界 | rebuild/phase1/baseline-tests.log、final-tests.log；平台 API 为模拟，不能作为硬件验收 |
| 契约模拟 | 正常/重复/过期/离线样例与负例5项通过 | rebuild/phase1/contracts-tests.log；不是数据库或公网服务验证 |
| 已安装 Hermes handler/真实回环WS | 首轮7类、补测8类检查通过，固定版本0.21.5+9117.g08165d5 | hermes-probe.json / hermes-websocket-probe.json；实际断开唯一WS连接并恢复同一srq、原任务与队列；合成任务、同一owner进程 |
| 真机基线/实验入口 | 手机初始安装0.1.15 /10015，后升级本轮0.1.16 /10016并明确启动专用实验页 | baseline-inventory.json、device-lab-start.log、device-summary-initial-connection.json；页启动通过、连接failed(disconnected)，未发卡 |
| 真机功能/端到端/全天 | 本轮未通过，保留待测 | P10 T1–T7、P12预算表、真实模型及 owner重启恢复实验 |

当时测试数量仅表明代码回归范围；上述最早表格不是最终验收。后续旋转/短按/固定头势已有实测，按钮自定义/动画仍未知，详见权威汇总。后台网络消息尚缺持久收信链；双人段内聚类已有实现但未获得本轮准确率、耗电和锁屏连续性数据。

候选构建使用独立 ASCII 临时目录，不覆盖原构建或其他 Agent 的暂存目录。inventory 保存安装包/模型/证据哈希，并对比当前源文件与实际编译暂存源文件。HAP、模型、凭据、用户资料及实验 Hermes 存储不入 Git。本轮未推送远端。

Git：修改前基线 `149cbbc`；本批代码与首轮实验/设备证据提交 `ece44af`，后续设备观察另作追加提交。官方BASE差距清单已建立，不等于所有原厂入口已走查；在最早交付时P10只通过安装/实验页启动；后续二态输入与P12短时只读后台已有实测，功耗/说话人仍未验，P11未通过真实模型/owner重启。未达出口的项保持待验，不用这份文档宣布整批产品验收完成。

## 复现

在项目根目录执行 `rebuild/phase1/verify.ps1`，需 Node 与现有 DevEco SDK；可传 DevEcoHome/NodePath。契约依赖以 tools/phase1/package.json 固定；本机使用既有 Ajv，另一机器先安装该目录依赖。

执行 `rebuild/phase1/build-candidate.ps1` 可在专用临时目录构建未签名包，需既有 DevEco 与 OHPM 依赖。sign-candidate.ps1 只引用现有本地开发证书，生成 phase1 专用签名产物并恢复临时配置，不覆盖旧 artifacts。Hermes 实验需使用本机安装 facts 对应 Python，脚本开头记录隔离方式；外部网络和业务执行均不参与。inventory.py 只读重算哈希。

P10 先观察原厂卡焦点和旋转，再安装受控实验包做合成卡的短按/头势/回执；原厂卡若提交会创建真实待办，本轮不盲操作，保留该提交路径未测。P12 需获授权双人样本与前台/锁屏、充电/未充电配对采样。P11 实际回环传输断线已测，还需用户真实 gateway/模型及 owner 重启恢复；这些出口没有被合成任务代替。
