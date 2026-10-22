# 提词朗读跟随及可读列表：原版协议核对

日期：2026-10-14，关联BASE-08/P25、GAP-14及H01。本记录是实际本地原版产物检查，尚不表示独立App或当前固件已支持新增能力。

## 源与已核对事实

`reverse/libapp/libapp.so`与JADX提取的同名arm64库SHA-256均为`eba61c2b6c161b05da0c68018d81240257eb4986037f746f8646f40f641be6dc`。提取AndroidManifest标明1.0.0/code52；这是本地研究产物的清单值，不替代当前手机参考App版本登记。

| 范围 | 实际读取的证据 | 结论 |
| --- | --- | --- |
| 模式值 | `reverse/blutter-out/pp.txt`中`pp+0x2b720/728/730`与`pp+0x43c10` | followSpeak=1、linearScroll=2、manual=3；本App目前准备/开始/调速均固定2 |
| 音频入口 | `RayneoNetPluginBridge.java`365–377；`AiRuntimePlugin.java`1942–1948 | 原版在TELEPROMPTER业务接收AssistantMsg type9的data，作为Opus交给手机侧ASR；不能把type9当普通JSON控制包 |
| 连续识别 | `airuntime/asr/AsrTaskCoordinator.java`及`TeleprompterAsrSession` | 原版有独立提词ASR会话、结果/结束与清理接线；本App的CloudASR当前首句final即停、40秒保护，直接复用无法提供连续跟随 |
| 位置 | `teleprompter_line_layout_provider.dart`239df2c/239df48；headless mapper字段及`pp+0x43a88/90/98` | 原版结合正文、显示设置和段落布局，维护行起点、字符及字节映射，再下发type8位置。尚未还原完整算法与单位，不用简单字符串匹配或猜测像素/字节冒充对齐 |
| 标题 | `TeleprompterBleItem.toJson`23a34e4调用14b86f8；原生14b8808及对象池 | 列表项可携带did/pin/title/offset/scroll/total，低层UUID文件名与可读标题是两个字段；当前标题仅在手机，退出镜片留UUID已由用户确认 |
| 列表包 | `AppListUpdateRequest.toJson`23a3170→22c95fc；`GlassesListUpdateRequest`2635e68→22c93f0 | App列表JSON有action、type、total、chunkinfo、items；action字段值2。type的具体枚举语义待还原，不能凭类名把它当code成功回执，也不能混同外层消息type1 |
| 分块 | `_ChunkInfo.toJson`23a31c4→14b863c，`pp+0x4d020/38/40` | 列表有chunkinfo/chunkid/islast及整体total；未查明是否替换/裁剪未知眼镜文稿，不发送只有当前稿的全量列表来试标题 |

以上原生地址由本机DevEco SDK的`llvm-objdump -D --triple=aarch64`与blutter对象池交叉读取。普通`-d`把该段误作数据，后改为`-D`；早期研究中将对象池`pp+0x4b08`误猜为code，实际为type，现已纠正。函数存在、枚举值和源码分析均不是当前眼镜真机通过证据。

## 实施范围与验证出口

朗读跟随完整接线需要：明确的模式与显示参数、同一会话type9音频、连续ASR及有界队列、正文/识别对齐和阅读位置映射、type8下发与回报、旋钮手动干预/暂停/重启/断连后的游标处理。识别失败应暂停跟随并保留稿件和位置，不能悄悄改为匀速后显示“跟随已支持”；也不能占用现有录音/智记或助手的解码器。

下一取证先还原位置转换及开始/暂停时麦克风需求，再用已授权电脑外放的独立测试语音验证多句连续输入、停读/重读/跳句、手动滚动后的定位。镜片跟随与阅读体验候选准备好后更新H01，集中请用户观察。当前没有新候选，不安排重复点头或旋钮测试。

可读标题需要稳定的本机稿件/眼镜did映射、列表同步与分块确认、未知稿保留策略及冷启动恢复。原厂列表更新的替换语义是实施前置；如果协议不能无损合并，需要明确迁移范围和可审阅方案，再做产品操作。尚未触碰眼镜列表或固件。

构建方面已发现固定旧暂存少两份Vendor文档，下一功能候选以独立构建批次目录及签名前后来源核对为前置，见后续构建记录。资料、其他BASE与P43按原依赖继续；Excel未改。
