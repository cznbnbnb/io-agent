# 提词本机流式识别候选

日期：2026-10-15。P25 / BASE-08 / GAP-14 / H01。前置是[0.1.70候选与失败恢复](./phase2-teleprompter-follow-candidate-2026-10-15.md)。本批复用传稿/控制、正文匹配和独立Opus解码；不改变正式官方对齐门槛。

## 选型及来源

本地已有sherpa_onnx 1.13.3 HAR，其 `StreamingAsr.ets` 真实导出 OnlineRecognizer、OnlineStream、OnlineZipformer2CtcModelConfig及原生创建/推进/端点方法。原SenseVoice按离线文件/窗口识别，保持原样，不把它改名当作流式接口。

候选采用[上游中文小型流式CTC模型](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-ctc/zipformer-ctc-models.html)和现有运行时。作者[原始模型卡](https://huggingface.co/csukuangfj/icefall-streaming-zipformer-small-ctc-zh-2025-04-01)列Apache-2.0；原卡与ONNX转换仓的关系已核对，资源附LICENSE和UPSTREAM说明。模型仅作中文候选，不宣布其他语言或正式准确率已支持。

ONNX仓固定修订 `a5f60fe00dcfbaf68fcc1c6b5cf53061e144d6da` 已从作者主仓核对。模型26342340字节，SHA256 `68c9c943840f7d9cf3e8a4970ba50f404feb5277f611fa82b7e72267786fa84a` 与[作者公布值](https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01/blob/main/model.int8.onnx)一致；词表13366字节，SHA256 `6fed8c6c248516f38e7faa19404b57413e8ce259f1cbc1fa4aebc86eac32fdfd` 固定取得的该修订字节，不冒充另有作者公布摘要。

本机直连GitHub/HF超时，授权服务器取回失败且自建临时目录已清理，未改服务/网站/数据库。最终仅经hf-mirror搬运数据，模型按作者摘要验证；未执行远程代码或加载PyTorch pickle。取回、模型缓存和桌面完整识别文本保留私有；[来源白名单](../../rebuild/phase1/prompter071-model-source-2026-10-15.json)公开必要摘要。ONNX沿用项目的大文件忽略约定，构建时必须有对应固定字节；词表用Git属性保留字节，避免Windows换行转换破坏摘要。

## 实际代码与调度

- 正常提词页默认仍是匀速；显式可选本机中文跟随候选或云端候选。选择本机时不读取云Key，也不因本机失败自动切云端。云端路径保留现有显式配置前置。
- PrompterModelStore只在需要时从HAP提取该模型到独立私有缓存；不触原录音/智记模型或用户音频。Worker加载前逐块校验模型/词表SHA，不把破损文件直接交给原生构造器。
- LocalFollowEngine在专用Worker使用真实OnlineRecognizer，16kHz PCM、两线程CPU、greedy/端点切句；连续部分结果替换，跨句继续。与原AsrWorker分别注册，不在UI线程加载或推理模型。
- LocalFollowASR按代际隔离开始/暂停/继续、复制后清零的短PCM及应答。最多积压64000字节约两秒；旧文字/旧应答不推进，重复旧退出回调不能释放新Worker租约。30秒启动边界，实际onexit前不创建下一同类Worker。
- 已准备模型在暂停期间保留，继续创建新识别流；退出/断连/销毁终止Worker。提词占用时归档转写留在原耐久队列，提示排队；实际Worker退出后唤醒归档，已有运行中的手动/完整转写则阻止候选进入，避免抢占。正式智记共存和全天预算仍须单独对齐，未据这道候选门禁宣布通过。
- 识别早于开始ACK时只暂存最新位置，确认运行后再下发。识别错误不会被收到音频的成功提示覆盖。日志只含来源、计数、字数、RMS和匹配状态，不保存此次语音或识别全文。

显示行映射仍沿用已明确标识的字节上下文候选，未复现原版TextPainter完整布局。可读眼镜稿件列表没有在本批替换，未知稿保留策略继续研究。

## 验证分级

桌面真实模型：Windows Python sherpa-onnx 1.13.3，独立ASCII目录，合成中文20.1秒按100ms音频块推进，32次更新/4句终结；模型加载858.54ms、推理444.56ms，首个文字对应0.8秒音频坐标。这是快速喂入的桌面检查，**不是手机耗时、实时墙钟延迟或准确率验收**。初始Windows中文路径原生词表读取失败，改ASCII目录后成功；随后报告脚本变量错误也已修复，失败不追认为成功。[桌面白名单](../../rebuild/phase1/prompter071-desktop-model-2026-10-15.json)。

最终App宿主回归910/910通过，含有界排队、早到PCM、模型校验、旧回调/退出租约、取消提取、不读云Key、队列恢复及旧生命周期。首轮10项旧装配缺新增初始化方法、新队列用例缺合法源及预期路径问题均保留并修正；它们不被表述为真机通过。两个初期编译及第三轮编译/验签成功但未安装，随后发现专用Worker构建注册尚需补齐，再按新快照构建，保留旧产物。

最终冻结run `20261015-024448310-d964efaf`：真实DevEco编译、签名及官方验签通过；771份来源/路径在签名前后及设备测试后再次核对，原音与词表摘要保持。HAP475128657字节，SHA256 `c454558f8ce60d1053ac1ce254f8a8792ec1b4a1ebfc77327fd2d11adde50a46`。910项回归早于最后的Worker注册配置修改，所有可执行App逻辑未再改；真实最终构建和设备Worker加载另行取证，不重命名回归时点。[构建冻结](../../rebuild/phase1/prompter071-build-freeze-2026-10-15.json)、[来源审查](../../rebuild/phase1/prompter071-source-audit-2026-10-15.json)。

0.1.71/10071已实际覆盖安装、版本读回并换新进程；录音、智记及耐久转写空闲，只有自有未保存稿。正常页选择本机候选，模型从HAP提取到独立目录，Worker校验/原生OnlineRecognizer载入成功，225字节中文稿取得business17完整文件及business20联合ready。随后开始type3/action2/code1，实际收到了2506个type9音频包并成功解码，观测为每包960个16kHz样本、约60ms节奏；没有启动云ASR或真实任务。

**本轮仍未通过有声跟随**：电脑已按API外放合成中文，但51条采样记录的RMS均0，识别文字事件0、匹配偏移0，未下发由识别触发的type8。不能把发包、静音解码或模型装载称作跟随成功。已回传的隐私设置mic_switch=1，原版LocalVad源码也明确16k/mono，与当前解码一致；佩戴、骨传导、音源路由及电脑真实输出的关系仍未确认，不猜定原因。未调整硬件隐私开关或记录此轮音频。

已从正常页退出，收到同did type6/action2/code1并回idle；原第10版canonical、原音、原ASR、outbox最终字节不变。[真机白名单](../../rebuild/phase1/prompter071-native-silence-2026-10-15.json)。新原始UI/日志和完整桌面结果留在私有目录，不公开识别文字、密码或音频。

下一出口先独立核对电脑实际外放/环境声是否被接收及原厂提词音源路径，再准备H01-F03的必要佩戴对照；用户不需重复朗读。镜片效果、重读/跳读/手动回退、长时稳定性、功耗、其他语言及完整BASE-08保持开放。无需这些条件的显示行映射、无损可读稿件同步和其他计划项继续推进，不把本轮静音当全项目阻塞。Excel未改。
