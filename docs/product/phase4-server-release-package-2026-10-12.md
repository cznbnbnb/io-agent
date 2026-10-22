# P42/P43 与只读后台的服务器发布包

日期：2026-10-12。状态：源码包、生产盘点、本机升级/回退演练通过，**已发布到生产**；独立查账确认 deployed，公网 HTTPS 五项检查通过。带权限的统计查询和手机任务端到端仍待验证。生产未触发回退，本机回退演练不能替代生产回退证明。

## 当前生产及本次范围

最新只读核验：`turboio-material.service` 为 active；Node v22.23.2；服务器本机和开发电脑公网 `https://cznbnb.cn/io-api/v1/identity` 无凭据均401。原443阻塞已经解除，不再需要更改 Clash、网站或防火墙来推进。

运行位置仍为 `/opt/turboio/rebuild/material-server`，主数据库 `/var/lib/turboio-material/materials.sqlite`，nginx 回环3401。核验仅读取固定源码文件哈希、服务状态、运行时及磁盘，不读资料或令牌。

本次源码包 `rebuild/phase1/artifacts/io-server-20261012-r1.zip`，SHA256：

`ec20e04b2e15d454090011404045da5341599b235569c76491a999cd66f3748d`

包内固定14个文件（12个运行文件和2个契约），外加manifest；不打包凭据、资料、数据库、node_modules、网站、nginx、systemd单元或部署脚本。主资料库不新增迁移，契约和 npm 锁定依赖必须与当前线上精确一致。`.node-version` 是新补的文本声明，实际运行时不升级。

生产差异只有8个运行文件：

- 修改 `store.mjs`：保留原始委托允许开始的期限 `command_expires_at`，后续状态修订不能延长；新增同owner、独立 operations:read 的只读摘要。
- 修改 `http.mjs`、`cli.mjs`：挂接只读页面/摘要和独立流量侧账本。
- 新增 `traffic.mjs`、`.node-version`、`admin/index.html`、`admin/app.js`、`admin/style.css`。

流量侧账本为 `/var/lib/turboio-material/materials.sqlite.traffic.sqlite`，记录已鉴权请求的时间、主体、固定路由类别、状态码、正文收发字节与耗时。不保存令牌、资料正文、原始URL或查询参数。页面自己的摘要刷新不计入设备转发流量。它不是 TLS/HTTP/网络总账单，也不会补算上线以前的流量。流量账本失败时主资料/队列仍可用，后台明确显示统计缺失。

新管理入口已上线：`https://cznbnb.cn/io-api/v1/admin`，公开的只有页面外壳；统计需 operations:read 专用短期凭据。令牌只保留页面内存，不自动启用任何真实任务。未签发管理或手机任务凭据，尚未验证生产带权限的统计查询。

## 可复现验证

1. `node rebuild/material-server/verify.mjs`：39/39真实本机 SQLite/进程/HTTP 检查，包含资料18、队列14、后台7。报告源码哈希必须与包文件一致，旧绿灯不能为改后的源码背书。
2. `python -I -S -B tools/phase1/test-server-release.py`：7/7发布包防护检查，覆盖私有数据排除、未验证源码拒绝、失败报告拒绝、哈希篡改、额外/越界文件、manifest输出路径及禁止覆盖旧包。
3. `python -I -S -B tools/phase1/package-server-release.py --release-id io-server-20261012-r1`：固定文件白名单打包。已有同名包时拒绝覆盖；需要新包用新release ID，不能改包后继续沿用该SHA。
4. `python -I -S -B tools/phase1/server-release-preflight.py --archive <上述zip绝对路径>`：只读SSH双次源码快照、防止盘点期间另一发布者修改；核对现有单元、Node、HTTPS、容量及共享契约/依赖。
5. `node tools/phase1/rehearse-server-release.mjs`：28项本机演练通过。实际启动 e2052f8 旧CLI，创建合成资料/任务，关闭进程后切换到本包，再切回旧代码。

第5项的旧变更文件从Git取出并逐个核对线上SHA；未变文件只在包内SHA精确等于线上时复用。Schema部署文件曾采用CRLF，不能拿Git的LF字节误报线上变动。原回执比较按JSON语义，不能把字段顺序差异当数据丢失。

演练验证原身份、旧凭据、资料、原回执ID和重复投递去重继续有效；新版可从旧任务恢复原委托期限，后续状态更新不续期；只读外壳可读，手机身份不能查后台，operations身份可查独立流量；代码回退后仍保留升级期间写入的任务revision2，原侧账本保留。未恢复旧数据库快照覆盖新写入。Windows子进程停止不等同于Linux systemd正常停机，因此生产发布时仍需实测。

证据均在 `rebuild/phase1/`：

- `io-server-20261012-r1-manifest.json`
- `io-server-20261012-r1-preflight.json`
- `io-server-20261012-r1-rehearsal.json`
- `server-release-package-tests-2026-10-12.log`

## 生产激活与回退要求

生产激活需单独固定操作范围；先准备并检查完整同文件系统暂存目录，保留现有依赖及文件权限，核对主Schema/锁定依赖未变，再在切换前复查线上旧哈希。当前旧store SHA为 `58df925b679aaa6d2209e8687168e6fc56e1752ef9546d75abf66646a471123b`，其余旧/新哈希由manifest和preflight逐项记录。

短暂停止仅 `turboio-material.service` 并确认进程退出；保留完整旧代码目录，再切换完整新目录，不能运行新旧混杂的文件集合。不改变既有单元路径、nginx、网站ev/Node20、MySQL、证书、主数据库或设备绑定。

新服务启动后核对运行文件SHA、active、回环health、公开TLS401、静态后台200及 CSP/无缓存。业务摘要必须用独立授权凭据另测；无凭据401并不证明统计查询或任务闭环成功。

失败回退先对比当前哈希，拒绝覆盖另一发布者的后续修改；停止独立服务，恢复保留的完整旧代码目录，再启动核验。**不恢复旧主数据库、不清空资料、不删除流量侧账本**。SSH观察超时不能当作进程终止或发布未发生，必须核对同一进程/部署状态，不盲目重复切换。

### 已实现的发布/查账工具

`tools/phase1/deploy-server-release.py --archive <上述zip绝对路径>` 默认只读；只有显式 `--apply` 会上传并激活。控制器核对本机回归源码、包、原生产快照和升级/回退演练的 SHA，不能把旧报告套给新包。发布代码 `remote-server-release.py` 经 SSH stdin 接收已固定 SHA 的包，未安装到公网入口。

暂存、备份和持久部署记录都位于 `/opt/turboio/rebuild/`，以固定release ID命名；固定目录越界、重复发布记录、共享 Schema/依赖改变、非预期单元命令/Node、源文件哈希变化均拒绝。用文件锁约束遵守该工具的发布者，并在切换前后重新校验；不能据此声称能阻止无视锁的其他root程序修改。

暂存复制已装依赖，不下载或升级包，不复制凭据/数据库；依赖链接不得指向目录外。源码与依赖文件fsync，按目录层级fsync，使用实际 systemd 用户预热 HTTP/校验器及Schema读取。停机必须观察单元状态、MainPID=0及原PID启动身份消失；发出stop命令不等于确认退出。

状态保存在 `.material-server-release-io-server-20261012-r1.json`。SSH失败只会重新连接并读取同一记录、源码路径和PID启动身份，不重发apply、stop或rollback；进程仍活着则继续观察，状态不明则保留并人工核对。同一release ID已有记录时拒绝自动再次激活。

新增12项本机检查通过：`test-remote-server-release.py` 9项，`test-release-controller.py` 3项；覆盖健康失败回退保留新数据、old_moved/new_installed中断、切换前后其他写入者冲突、退出未确认不启动新实例、已有备份拒绝，以及观察丢失只查账不重发。服务回调在这些检查中为受控替身；真实CLI/HTTP/SQLite的28项演练为上一节独立证据。证据：`server-release-switch-tests-2026-10-12.log`、`server-release-controller-tests-2026-10-12.log`。

### 实际生产发布结果

`--apply` 已实际执行且返回 deployed；随后仅执行独立 `--inspect`，没有重复发布。Linux 发布过程确认旧单元停止、MainPID=0及原PID启动身份消失，完成整个目录切换后启动。服务 active、回环 health、TLS 未认证401、后台200及 CSP/no-store 检查通过；主数据库 inode 和 schema user_version=2 保持，未恢复数据库、签发凭据或改动网站/nginx/MySQL/Node运行时。

新 store SHA256 为 `a7a57d04e771188a928501bf74453c673c6694aad6b8e4cf9619dc25edb6305c`，逐文件结果与发布包一致。旧代码完整保留于 `/opt/turboio/rebuild/.material-server-backup-io-server-20261012-r1`；部署账本为同目录 `.material-server-release-io-server-20261012-r1.json`。原 preflight 仍保存发布前基线，不得用新版覆盖后重复 apply。

公网 HTTPS 实测：identity401、admin及两个静态资源200且逐文件哈希匹配/CSP/no-store、无凭据 operations/summary401。它证明页面发布和未认证访问限制，不证明统计业务或任务闭环。证据：`io-server-20261012-r1-deploy.json`、`io-server-20261012-r1-deployment-inspection.json`、`io-server-20261012-r1-public.json`。

## 后续依赖

手机任务专用凭据和后台只读凭据仍未签发。此前自动审批曾拒绝未明确接收方、scope和期限的新凭据申请；后续必须准备这些具体参数再请求授权，不能借用资料同步凭据或在公网暴露发令牌接口。现有资料同步凭据到期也不能悄悄扩权续发。

新服务发布之后仍需登记生产 managed Hermes 现有ACP会话、受限工具及真实模型，才能进行手机文字委托—原会话提问—手机回答—原任务继续—结果返回。P43页面、发布包、合成模型集成都不能代替此端到端验收；原音、后台功耗和官方基础体验差距仍独立跟踪。Excel未更新。
