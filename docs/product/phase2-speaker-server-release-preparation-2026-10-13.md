# P23 资料 1.2 的 r3 发布准备

当前最终冻结包已在腾讯云真实部署，独立 iO 服务 active，真实公网1.2合成资料与实际只读 CLI 后验通过。最终源码绑定 `a1cbf1900cc0513a98b9f106f2b6462598bd8f5b`，包含此前 `cb1fa32` 的原音 missing 修复及已审核发布工具；此前 ec3bded/precommit/before-missing 的候选证据不用于本批发布。手机实际1.2上传及真人说话人准确率仍待验收。

## 专用入口与固定范围

1. `tools/phase1/package-speaker-server-release.py --release-id io-server-20261013-r3 --source-commit <40位审核提交>`：生成唯一 source-only zip，绑定正式验证报告和源码 SHA，以及指定 Git 提交的完整包内容（仅允许 LF/CRLF 差异）。不能覆盖已有 zip。
2. `tools/phase1/speaker-server-release-preflight.py --archive <zip>`：只读核对现有 r2 14 文件、固定主机、Node22、systemd 运行参数、容量、回环 TLS、公网 TLS 和新 Schema 的不存在/同字节状态。
3. `tools/phase1/rehearse-speaker-server-release.mjs --release-id io-server-20261013-r3 --baseline-ref d2e9585`：使用原 r2 固定源码 zip 在本机隔离目录真实启动旧/新 CLI、HTTP 与 SQLite，演练升级及仅代码回退。
4. `tools/phase1/deploy-speaker-server-release.py --archive <zip> --inspect`：默认只读观测；只有后续明确执行 `--apply` 才调用已审核远端发布器。本次准备未发送 apply。

新包采用 `material-speakers-v1.2` profile，固定15文件：原服务12运行文件、原 1.0/1.1 Schema、新 1.2 Schema。实际上只改变 `store.mjs`、`validation.mjs`，新增 `docs/contracts/event-v1.2.schema.json`；其余12文件必须与已记录线上 r2 字节一致。查询 CLI 在电脑本地使用，不放入生产服务运行目录。包不含 App、node_modules、测试、资料库、凭据、声纹、部署脚本或用户正文。

不使用旧仅 store 发布器。原 r1/r2 打包及只读检查入口保持原规则；新控制器有独立 Schema 2 manifest/profile、committed source 守卫、69项正式服务回归（含查询11及说话人11）和专用演练要求。真正 ArkTS Wire 跨层测试在本机需要已有 DevEco 编译器：运行验证前设置当前进程 `DEVECO_HOME=D:/APP/DevEcoStudio`；这不改变服务器运行依赖。其实际源码与测试夹具也纳入证据摘要。

## 当前线上事实

北京时间 2026-10-14 00:57 的发布前只读检查确认线上14文件与原 r2 包完全一致，新增 Schema 1.2 尚不存在；`turboio-material.service` active、Node v22.23.2，回环 HTTPS 与公网 HTTPS identity 均返回未认证401。同一 release_id 的发布前账本检查返回 `not_recorded`、无 stage/backup/rejected 目录，证据保存在 `io-server-20261013-r3-before-apply-inspection.json`。

获得根 Agent 基于既有用户授权的 goahead 后，仅执行一次当前最终包 `--apply`，远端耐久账本返回 `deployed`。随后对同一账本的只读 inspection 确认 active、当前12运行文件及3个Schema全部匹配冻结 manifest，backup保留原r2完整代码，stage/rejected均不存在。网站、TLS、nginx、既有凭据和用户资料未修改；只新增本批独占合成 owner 的六个资料修订，以及随后已撤销的最小scope短期测试凭据。

原 r2 固定源码包 SHA：`d9da06dd99f08aee9c73b9d0098b912771209a88e20a8b33c6eb496bb0c3c97b`。预检严格比较该包的14文件，不覆盖其他开发者改变的线上源码或未知 Schema。

## 激活、失败及回退

远端沿用固定路径 `/opt/turboio/rebuild/material-server` 与原目录切换器。已审核1.2 profile 只允许独占创建一个新 Schema：`/opt/turboio/docs/contracts/event-v1.2.schema.json`，创建并 fsync 后核对 SHA；存在未知内容或符号链接时拒绝，原 1.0/1.1 Schema 永不替换。

新 Schema 先准备好，旧 r2 validator 不会因为文件存在就自动支持1.2。然后 staging 新运行目录，复制原已固定 node_modules，检查 Node 语法，并以实际服务用户加载全部 validator/schema。Schema 可读与校验成功后才停止独立 iO 服务，确认旧 PID 退出，再整体切换代码目录并启动，防止新 validator 生效时缺 Schema。发布锁、每阶段耐久账本、源码和 Schema 代际栅栏防止并发覆盖。

后验失败仅在当前仍为本批新代码/Schema 时恢复保留的完整 r2 目录，不恢复数据库、清空资料或更换凭据。新1.2 Schema 保留为未被 r2 引用的文件，避免回执丢失后误删共享文件；r2 恢复原能力声明，不再接受新1.2事件，但已保存1.2不可变 JSON、回执、主体身份和主库 Schema 2 必须完整保留。待1.2 outbox 需保留失败状态并等待服务恢复，不能删除字典降回1.1。

SSH观察失败只重新检查同一 release_id 的账本、PID/start 身份、代码目录和 Schema 摘要；不重发 apply。不能因阶段日志或超时断言未执行、进程已停或回退已成功。未知/代际冲突保持需要查账，不覆盖另一写入者的状态。

## 准备验证与限制

- 正式服务验证69/69，使用真实临时 SQLite、HTTP、实际查询 CLI，并含本机真正 ArkTS Store/Wire 导出的原音 missing→人工更正组合；不是手机真机测试。
- 1.2 发布包防护14项、目录切换/新Schema防护13项、控制器防护8项通过，含报告准确记录实际新控制器、打包器、远端发布器、预检和演练五个脚本当前 SHA 的断言。控制器/服务生命周期回调为显式替身；Windows缺少的 Linux O_NOFOLLOW/fchmod/目录fsync仅在防护单元测试中显式模拟，不能据此声称 Linux 实际部署成功。
- 最终冻结包 `rebuild/phase1/artifacts/io-server-20261013-r3.zip` SHA-256 为 `7e9bcb9889e12135c82c2e579bc64f92230ebb504d5cf0f1aa2f24595ab15c1f`。重新预检通过，实际变化仅 `store.mjs`、`validation.mjs` 和新增1.2 Schema；正式69项验证的当前源码 SHA 全部匹配。
- 与该最终包 SHA 绑定的升级/回退演练真实启动旧/新服务并完成43个事实检查，证明保留主体身份、凭据、不可变1.2资料、原收据、旧资料和原1.0/1.1 Schema，回退后拒绝新1.2事件。此证据使用本机合成 SQLite；实际 Linux/systemd 激活成功另由真实远端 apply/inspection 账本和公网后验支持，尚未在生产环境执行回退。
- 最终 manifest/preflight/rehearsal/deploy/deployment-inspection JSON 与 `speaker-release-rehearsal-2026-10-13.log` 已重新生成。apply/inspection 精确记录实际5个发布工具的 SHA，报告 `deployed`。远端`owner_alive:false`仅表示一次性发布程序已结束，与 service active 的常驻服务状态分别记录。
- `tools/phase1/verify-speaker-cloud.py --run-cloud --run-id speaker-r3-20261014-0104` 真实公网后验17项通过：reader/writer identity均声明1.0/1.1/1.2，资料r1–r4写入、拆句同事件重放返回原收据、r5原音missing、r6人工文字更正及精确字典/父范围读回；实际 Node 查询 CLI 保留未知子句时间、父r3来源、不可变原r3、资料内speaker-ID查询和完整r1–r6增量；只读凭据写入403。全部为电脑合成driver，手机、眼镜及模型均未参与。
- 本批测试owner为`synthetic-cloud-speaker-r3-20261014-0104`，资料ID为`synthetic-r3-speaker-r3-20261014-0104`。writer仅materials写/读和changes读，reader仅materials/changes读；凭据以独占私有文件签发一小时，不覆盖已有凭据，完成后双方均撤销且公网identity实际返回401。合成修订保留在该隔离owner中，没有清空用户资料或删除不可变记录。证据见 `cloud-speaker-r3-20261014-0104-speaker-verification.json`。
- 仍需手机实际1.2更正/上传、真实手机离线补传及真人说话人准确率的证据；本批公网合成通过不能关闭完整 P23、原音恢复/归档或真人说话人准确率验收。
