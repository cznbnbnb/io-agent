# 普通录音删除与冷启动恢复

日期：2026-10-14。关联P21/P24/P32、BASE-03的资料删除部分。沿用已安装0.1.63/10063和既有删除接线，本批补齐RecordingPanel普通页至公网及冷启动的单项验收，未修改产品源码或重新构建安装。

普通录音页已完成“打开文字→取消删除→再次删除→详情清空→同ID墓碑→源目录清理→服务器保存确认→查询410/撤回增量→冷启动不复活”。这条出口与此前普通智记删除独立验证，不能由智记结果代替。

## 测试资料和操作边界

四份源文件为独立新目录中的`source.rawopus`、`audio.wav`、`manifest.json`及合成文字。音频是此前用户授权的0.1.23熄屏朗读测试的副本；原始710880 bytes，WAV 3791404 bytes、16000 Hz/PCM16/双声道、59.24秒。新ID、时间、清单和文字专用于删除实验，合成文字不是该副本的新ASR输出。本批没有新采音、转写或原音上传。

测试源为`take-3bcf5fc1deda45d9a9a50a3823003852`，资料ID为`mat-recording-3bcf5fc1deda45d9a9a50a3823003852`。投放前分别核对录音待命、智记未开启、ASR队列终态；确认新路径不存在后冷停App，传入并逐字节核对四份源文件。普通App启动后自行迁移资料并发送消息，驱动未写canonical、outbox或回执。

普通页通过唯一时间、录音行按钮和已打开的合成标记确认目标。打开详情后录音行会被推到屏幕外，操作脚本按当前布局滚动再定位；未用旧坐标确认删除。所有删除操作只作用于这一新测试副本。

## 正常页和公网结果

| 项目 | 实际结果 |
| --- | --- |
| 删除前 | 普通录音页“查看文字”显示合成标记；第1版upsert，710880 bytes、complete=true；正常手机取得server_stored，云端commit_seq=46 |
| 取消删除 | 实际确认框点取消；正文仍可见，canonical第1版及四份源文件字节保持，公网仍为同一第1版/commit_seq=46 |
| 确认删除 | 实际录音确认框点删除；当前选中正文从原生UI树清空，源目录不存在；同ID第2版delete、正文为空 |
| 服务器确认 | 第2版在持久outbox为server_stored，receipt_id存在、commit_seq=47；手机实际两份消息的payload哈希、body与公网查询分别一致 |
| 最新查询和增量 | 实际CLI返回HTTP410/MATERIAL_DELETED；按本资料ID过滤的增量恰有一条第2版撤回，正文/句子/说话人为空，来源引用指向同ID第2版 |
| 冷启动 | 在再次核对采集/转写空闲后冷停并启动，新PID已确认。第1版历史及第2版墓碑字节保持，整个outbox账本字节保持；源目录仍不存在，没有第3版；正常录音页条目与正文不复活 |
| 冷启动后公网 | 最新查询仍410，撤回body和commit_seq仍47，没有重复删除增量 |

服务器存储确认只证明资料事件持久保存，不代表眼镜展示、Agent接收或任务完成。本地不可变历史修订仍保留，删除当前记录不等于物理擦除全部历史文字。

## 构建绑定和资料保护

实际设备版本重新读回0.1.63/10063；本批RecordingPanel、RecordingSession、RecordingService、MaterialStore、MaterialOutbox、MaterialSyncService及相应删除组件测试源摘要均与冻结构建一致。沿用run `20261014-082906559-0f8eeab2`及签名HAP SHA256 `141192e16597faba9ad9e5e69d63f0a8f372f7c89bed353d57d47ed17f7d90ec`。既有组件回归和编译范围见[0.1.63批次](./phase2-journal-summary-revisions-2026-10-14.md)，本批不重复计入新的完整回归数量。

冷启动实际读回受保护智记第10版、原音与原始ASR，分别保持SHA256 `83248d4c6b50ed750875be3fb52b5907cc0e5d823aaed9d5b5e8d1687bfed6a5`、`cd2ba1e3a85dfb445fed45ec8bf5c0d29acd261a579349c9bcedc5462e0477e1`和`97c7ae1b6e397343cca293a833598a0011edce2751fb7f9f91f17e1169679cc1`。被复制的两份桌面原始测试音频也保持原哈希；不将这些定点核对扩大为所有用户文件的保全验收。

公开证据：[recording-deletion063-native-cloud-2026-10-14.json](../../rebuild/phase1/recording-deletion063-native-cloud-2026-10-14.json)。[复核脚本](../../tools/phase1/summarize-recording-deletion063-device.mjs)只读实际源码、冻结构建及私有原始证据；[测试副本准备](../../tools/phase1/create-recording-deletion-fixture.mjs)与[实际CLI查询](../../tools/phase1/query-recording-deletion-fixture.mjs)分别处理本地源与只读服务器查询。音频、正文、完整布局、凭据和设备身份留在忽略目录。查询接口不暴露event_id，精确核对采用实际payload/body、资料修订、来源引用及server_commit_seq，回执关联使用手机持久账本。

## 仍待验收

文件占用导致清理失败、墓碑写失败、确认期间开始录音及真实ASR迟到等异常路径目前只有组件证据；普通录音的完整起停、回放、转写和助手共存需按BASE-03分别验收。原音云归档、真人说话人准确率、8小时稳定性与功耗保持开放。

下一场景按[开发入口](./DEVELOPMENT-STATUS.md)推进P23/P25基础差距。源码默认保留原音，但JournalPanel仍显示旧“转写后保留3天”提示，应在独立小批修正文案并核对留存行为；本批不混入这一UI改动。Excel保持原快照。
