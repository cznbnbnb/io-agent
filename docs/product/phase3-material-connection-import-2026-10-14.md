# P31/P32：正常资料同步连接导入

证据冻结：2026-10-14。本批代码基线`36a77b3`，原手机安装0.1.58/10058，现已覆盖安装 **0.1.59 / 10059**；服务端r3支持资料1.2。正常智记页的电脑登记入口、明确保存开启、手机同ID第1–10版存储回执及实际查询CLI读回已有真实证据，使用既有正式身份及保留的合成记录。没有新增隔离同步主线、换owner、批量改视觉或改Excel；本批局部端到端通过不关闭整个阶段3。

## 现状与本批范围

现有同步服务、持久outbox、identity门槛、先暂停旧writer再保存AssetStore均可复用。本批前正常页只有手工输入，旧正式凭据已到期；现已补严格导入和正常设置接线，重新签发正式身份最小凭据，不用旧文件或合成owner代替。首次开启会发现本机已有文字、元数据、历史修订及墓碑；原音仍未上传。

新增严格连接包读取，复用共享HTTPS target验证；新增独立只读identity预检；正常设置加入系统选择器及同路径的电脑登记入口。已保存与导入令牌只在私有候选中，输入框只用于手动更换，修改地址或身份不能复用旧Bearer。核对前不创建队列/Discovery，不替换现有同步；保存快照经再次核对后调用既有`Service.save`。详情见[连接包契约](../contracts/material-sync-connection-v1.md)。

异步load/picker/preflight使用页面代次围栏；收起、切页或新候选使旧响应无效。明确调用服务后的durable save可完成，旧界面不得宣称已撤销。登记文件只在成功保存且当前候选一致后清理，外部选择器原件保留。

## 已发现并修正的边界

- 共享target原来允许独立`.`/`..`路径段，HTTP归一化可把Bearer送到与显示不同的路径。已最小拒绝并取得Import输入红→绿及预检无HTTP发包证明，没有顺带重构所有URL规则。
- 更换令牌后的保存若保留旧boundExpiry，会使下一次保存将新令牌比对旧期限。已把实际identity期限与同一保存快照绑定；关闭态保存未经核对的新令牌时不继承旧期限。
- 旧save完成后先检查当前页面代次，再处理当前登记文件，避免迟到动作触碰新候选。错误文案区分预检未保存与服务受理后的状态不确定。

## 分层验证

| 层级 | 已取得的证据 | 边界 |
| --- | --- | --- |
| 代码/本机 | 项目Node22.23.2完整App760/760；组件46项、实际普通页事件方法13项均为760子集，覆盖load/picker/identity/save代次、固定快照及登记文件清理 | 网络、服务和选择器在组件测试中为明确替身；不等同ArkUI或公网验收。离线发行工具12项单列，不相加计算产品进度 |
| 编译/签名/安装 | DevEco CLI真实编译43.954秒、签名构建38.292秒，未用依赖缓存兜底；覆盖安装成功并读回10059 | 不卸载、不清资料；版本名不是安装证明，安装日志和实际读回分别留证 |
| 普通手机页 | 电脑登记入口坏格式拒绝且文件保留；有效连接只读identity预检，默认关闭、密码框为空；明确开启和保存后启用前台同步 | 系统文件选择器有效文件导入尚未真机；预检不等同保存或上传 |
| 手机→公网→CLI | 同一正式owner/phone下保留合成记录第1–10版均有server_stored回执；第10版schema1.2、commit_seq=41，实际CLI正文与手机真实envelope完全一致 | 不是电脑代发或隔离Lab；server_stored只表示服务器存储，不表示眼镜显示、Agent接收或任务完成 |
| 不同进程冷恢复 | 停止前确认采集/ASR空闲，新PID启动；普通设置恢复Asset字段、密码框仍空，28已存版本/0待同步；整个回执ledger字节不变，第10版云正文与commit序号不变 | 累计28版本是账本状态，不是28项产品验收；不证明新配置断网补传、长期后台或自动凭据轮换 |

首次全量误用DevEco内置Node18，12个模块因`.ts`/`node:sqlite`运行时不支持而失败；原日志`material-import-app-regression-node18-failed-2026-10-14.log`保留，不当作通过。最终冻结源码已用项目Node22重跑760项通过。

构建run为`20261014-031846465-6da8f85e`，源码manifest SHA-256 `a136ca2c6fbb03f4f4888b46f73c5449eed7460e252745b024423d8fe8249e7d`。签名包448510987字节，SHA-256 `786be69354d2d7f344333900cd004696a22f975b0a1e3e50c750b63f9b6799d8`；版本专用包保留为`entry-default-signed-0.1.59.hap`。真实构建状态、源摘要、编译/签名日志、安装及实际版本读回与公开结果绑定，不借用0.1.58日志。

## 正式身份及凭据状态

沿用正式owner `turboio-user`及手机producer `phone-harmony`，手机仅`materials:write`；电脑只读查询producer为`pc-query`，仅`materials:read,changes:read`。服务ID仍为`80384449-a5c6-4630-bf1b-524a30454c92`，真实公网identity均返回200并声明资料1.0/1.1/1.2。发行工具只新增短期凭据行和独占私有文件，没有替换旧凭据、改服务/站点/Schema或在发行阶段提交资料。

本次run为`formal-phone-20261014-0330`，24小时凭据存于忽略的`rebuild/material-server/private/formal-formal-phone-20261014-0330/`；手机连接包为`connection.json`，电脑查询配置为`query-config.json`，实际令牌分别只留`phone.json`、`reader.json`等私有文件及手机AssetStore。手机期限 **2026-10-14T19:32:04.173Z，即北京时间2026-10-15 03:32:04.173**；reader期限为`2026-10-14T19:32:04.648Z`。本批没有自动续期或扩大任务权限，令牌不入argv、日志或仓库；公开发行报告不包含Bearer。

## 普通页至公网的实际出口

普通页读取App私有`connection-import/material-sync.json`，走正常设置中的同一解析和identity预检。坏格式显示“连接文件格式不正确，未保存配置”，开关仍关闭，失败文件逐字节保留；有效预检只GET identity，界面身份/期限可核对，候选仍关闭，密码输入框为空。实际CLI在导入前及导入后、明确保存前读取第10版均返回`MATERIAL_NOT_FOUND`；不把导入或预检记成上传。

随后在普通页开启开关并明确保存，现有同步服务实际工作。专用合成资料`mat-lifelog-042bb7365e004cbb837949173a59f754`第1–10版逐一取得`server_stored`、receipt_id及server_commit_seq；第10版回执`63f0c77f-2976-4ab5-abd4-66fb5383ad65`，commit_seq为41。真实手机envelope SHA-256为`cc208b4d42ce86bf282bf6d10e6a5b235699cf986df2f4c0d632466839dfff40`；真实电脑查询CLI读回第10版、文字第9版，body精确等于该envelope body，而非重新构造的期望结果。

资料字典、用户确认来源、两条拆句的null起止时间及父第5版引用保留；实际CLI读回父第5版，对照原文切片和父原音范围一致，真实查询子句citation与父来源引用也逐项核对保留。“我”仍是这一条合成记录上的显式本段标记，不能据此说已识别用户本人或通过真实双人归属验收。原音尚未上传，查询明确`audio_playback_available=false`，不提供云端原音回放。

手机原第10版文件SHA仍为`83248d4c6b50ed750875be3fb52b5907cc0e5d823aaed9d5b5e8d1687bfed6a5`；原音SHA仍为`cd2ba1e3a85dfb445fed45ec8bf5c0d29acd261a579349c9bcedc5462e0477e1`，原ASR SHA仍为`97c7ae1b6e397343cca293a833598a0011edce2751fb7f9f91f17e1169679cc1`。不同PID冷启动后，普通设置恢复原身份字段，已存令牌没有回填密码框；当前累计28已存版本、0待同步，整个outbox/回执账本字节不变，云端第10版body和commit_seq仍为41。本批未观察到重启产生新修订或新存储序号；这不证明网络绝无相同请求重试，也不表示任务执行。

## 证据与开放项

主要公开结果：[真机与公网摘要](../../rebuild/phase1/material059-native-cloud-2026-10-14.json)、[正式身份发行报告](../../rebuild/phase1/formal-material-connection-formal-phone-20261014-0330.json)。复核工具`tools/phase1/summarize-material059-device.mjs`只读取实际私有布局、回执、envelope和CLI结果，核对源摘要/包/版本及上述事实后输出白名单摘要；不重新发网络请求、不公开凭据或原始声纹。

本机日志为`material-import-app-regression-frozen-2026-10-14.log`（760）、`material-import-components-2026-10-14.log`（46，属760子集）及`formal-material-issuer-offline-2026-10-14.log`（12工具检查）；13项普通页事件验证运行实际事件方法，未运行ArkUI构建器或原生观察，不代替真机。构建run状态和源码manifest、`candidate-build.log`、`candidate-sign.log`及`material059-device-install-2026-10-14.log`分别保存。原始布局、ASR/声纹、连接文件和完整CLI载荷只留忽略的私有目录。

仍开放：系统选择器的有效文件导入；这一正式新配置的正常页断网恢复；自动凭据轮换；原音归档/上传/回放；后台网络资格及8小时/功耗；至少20段真实场景与明确双人90%归属、“我”的可靠自动识别；真实Hermes通过skill使用本次正式查询凭据。普通合成资料子链已通过，P31/P32、阶段3、AC-SPK及全部BASE均不能整体关闭。P13未批准，不批量重写页面，Excel仍仅在用户明确要求时更新。

下一主场景：先收尾本批证据和开放边界，随后只使用普通页专用合成记录验收删除至云端410/changes，以及最新修订MD/JSON导出和每日汇总；再按P25/BASE清单推进提词器传稿、控制与切页保留等，不重新从零实现已有录音或硬件接口。
