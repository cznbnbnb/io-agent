# P21 文字覆盖与无损资料接口转换

日期：2026-10-11。上一基线6ff12d9，候选及实际手机版本0.1.39/10039。官方基础完整对齐门槛不变；本批没有部署服务器或自动上传。

## 已实现

- MaterialSource增加已测量帧数/帧时长/已知中断；主动录音20ms，智记60ms。未知帧数保持-1，智记声道继续unknown，不依据解码器配置认定麦克风来源。
- MaterialStore修订保存transcription_state、covered_ms、transcription_source_ms。采集封口与文字处理完成独立；覆盖包括已处理静音，不取最后一句结束或有效语音时长推断。用户校正保留覆盖。来源增长使旧complete降为partial；来源缩短或帧时长变化无法确认旧覆盖时回到unknown，文字保留。历史修订不重写。
- RecordingService的窗口/全段发布与旧JSON迁移接入真实覆盖。旧JSON只有明确且合法的transcription_complete/covered_frames/source_frames才导入覆盖，缺失或非法时保留全文/句子及unknown。全段录音结构化文件保存明确覆盖和处理来源。
- MaterialTranscript统一秒/帧到毫秒转换及合法性检查；MaterialWire读取指定不可变修订，携带完整Markdown、原有句子ID、独立处理状态和原音状态。localMaterialEvent是显式导出函数，不启动网络或改写sync_state。
- 网络事件新增明确协商的1.1 Schema及合成样例，1.0及四组生命周期样例保留。旧全文没有可靠时间轴时不虚构句子。speaker_basis的本地user映射user_confirmed；匿名不冒充实名。
- 事件身份和创建/过期时间必须由调用方显式提供并先持久化，转换器没有随机/当前时钟默认值。显式历史修订重试不会混入最新人工更正。UTF-8超256KiB拒绝导出且保留原件，分块协议尚未实现。本地verified校验不会生成服务器stored_verified或object_id。

## 验证

完整应用496项、原1.0契约5项通过；1.1 Schema、真实临时文件重启/写入中断/修订、错误覆盖、原文保留、过大载荷、历史事件稳定、合成诊断均包含在应用回归中。初次沙盒运行的真实rename被EPERM拒绝，使用获准的本地执行重跑通过；没有修改产品提交逻辑绕过真实文件重命名。

鸿蒙实际编译37.393秒通过，既有依赖/类型告警保留；签名成功。签名HAP447498469字节，SHA256 `b17b20e788a9696e80f025e11cb96d0439fc6224c60e0bfaf9197c8201dd88a2`。七份关键源文件与编译暂存逐项匹配，见[构建清单](../../rebuild/phase1/candidate39-source-manifest.json)。已确认本项目进程空闲后覆盖安装，bundle回读10039/0.1.39，未卸载或清资料。

PersistenceLabAbility增加wire-seed/wire-resume参数模式，只操作全新p21-material-wire-lab/run-13位时间标识目录中的合成资料；不导入RecordingService、不启动蓝牙、模型、采集或网络。使用真实手机文件系统先写入，再force-stop自有诊断进程，确认pidof为空，重新启动恢复阶段并核对不同PID。

| 手机检查 | 结果 |
| --- | --- |
| 旧Markdown无句子时间，全文无损、覆盖unknown | 通过 |
| 封口来源但只处理10秒，状态partial | 通过 |
| 人工更正后覆盖保持partial | 通过 |
| 实际进程重启后覆盖/更正恢复 | 通过 |
| 重启后重建指定旧修订、身份和日期的事件，JSON一致 | 通过 |
| 来源60→70秒增长保留更正、10秒覆盖及partial | 通过 |
| 删除事件全文/句子为空，旧来源扫描不能复活 | 通过 |

独立电脑工具对两阶段六个实际手机事件运行1.1 Schema校验，核对历史事件JSON一致、覆盖/增长/删除及真实进程重启标志；结果通过。第一次recv早于报告生成，随后读取同一run，没有重新启动seed或制造新样本。

证据：[写入](../../rebuild/phase1/device-p21-wire39-seed.json)、[恢复](../../rebuild/phase1/device-p21-wire39-resume.json)、[进程边界](../../rebuild/phase1/device-p21-wire39-process.json)、[独立校验](../../rebuild/phase1/device-p21-wire39-verification.json)、[结束状态](../../rebuild/phase1/device-p21-wire39-final-state.json)。这些载荷全为合成内容，可以提交；真实用户原音/全文继续只保留忽略目录。结束时关闭自有诊断进程并提交熄屏，无正在运行的采集/转写/上传/Agent任务。

## 未完成及验证边界

这不是实际有声采集/ASR覆盖的0.1.39回归，不是服务器存储、手机同步或Agent查询端到端。最新真实有声ASR及原生解码证据仍是0.1.38；最新新采集失败也仍保留，不因本批数据实验通过而关闭。

P30/P31仍需耐久发送队列、鉴权、事务/CAS/规范摘要去重、接收/查询/变化游标、明确server_stored回执及实际服务。发送方须按前序修订补传；本转换器不能假定服务器已有本地历史。超过256KiB的资料分块、来源稳定校验和音频独立归档仍待做。用户更正部分转写后，目前既有保护会拒绝后续ASR整体覆盖；保留更正同时补写尾部需要专门合并设计与测试，不能关闭保护后继续。

后续继续按[开发顺序](./DEVELOPMENT-PLAN.md)推进P30/P31，不因本批通过而关闭采集与官方基础体验验收项。
