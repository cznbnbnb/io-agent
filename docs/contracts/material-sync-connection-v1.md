# 手机资料同步连接包 v1

用途：通过普通资料同步设置导入一个候选连接，不是资料/任务消息，不自动保存或开启同步。正式手机身份与电脑查询身份分别签发；手机最小scope为`materials:write`，电脑查询为`materials:read,changes:read`。它们不具备任务执行权限。

文件为严格UTF-8 JSON、最多8192字节，只允许以下8个字符串字段。重复字段（含转义后同名）、未知字段、嵌套值和尾部数据一律拒绝。

| 字段 | 约束与含义 |
| --- | --- |
| format | 固定`turboio-material-sync/1`，包含格式版本及用途 |
| base_url | HTTPS API根地址，以`/v1`结尾；可带尾部斜线，不能含用户信息、query/fragment、编码路径或独立`.`/`..`段 |
| owner_id | 资料所有者，沿用已登记的身份 |
| producer_id | 本手机的稳定身份，不能复用电脑查询身份 |
| server_id | 服务的稳定ID，与实际`/identity`一致 |
| token | 32字节随机Bearer的43字符base64url形式；只在私有候选/AssetStore中保存 |
| token_id | 管理员签发的小写UUIDv4；用于文件对应关系，当前identity接口不核验此ID |
| expires_at | 合法UTC RFC3339、Z结尾、尚未到期；与identity的实际期限按毫秒时间值一致 |

三项身份采用既有target的`[A-Za-z0-9_.:-]{1,128}`约束。令牌不写入命令参数、公开日志、仓库或可见身份预览。示例使用无效的合成凭据，不是当前可用令牌：

```json
{
  "format": "turboio-material-sync/1",
  "base_url": "https://example.invalid/io-api/v1",
  "owner_id": "synthetic-example",
  "producer_id": "synthetic-phone",
  "server_id": "synthetic-server",
  "token": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "token_id": "12345678-1234-4234-8234-123456789abc",
  "expires_at": "2027-01-01T00:00:00.000Z"
}
```

正常入口先读文件，在独立HTTP客户端只GET`/identity`，核对实际owner/producer/server、材料写权限、期限和当前所需资料1.2能力。失败或取消不保存候选、不创建队列、不切换已有同步。成功后预览身份与期限，候选默认为关闭；用户选择开启并保存时，使用固定快照重新核对身份，再交给既有AssetStore/同步服务保存。已有同步保持原配置直到明确保存。

收起、切页、新导入或编辑字段使未受理核对失效。已被服务受理的明确保存可以继续完成；界面只抑制迟到显示，返回后重读实际配置。保存失败不能笼统声称原配置仍在运行。已保存/导入的令牌不回填输入框；修改地址或身份后，不能自动把旧令牌发给新目标。

优先用系统文件选择器。电脑登记辅助入口只读取App私有`connection-import/material-sync.json`，走同一解析和identity路径；没有启动自动导入或携带令牌的Want参数。保存成功且当前页/候选仍一致后才清理同一私有登记文件，系统选择器的原文件保留。凭据由管理员工具以独占文件签发，当前服务器TTL最多24小时；自动轮换、正式账户配对与后台网络能力另行验收。

## Android 限期续签（2026-10-24）

`tools/phase1/prepare-formal-material-connection.py --platform android --run-id <本次稳定编号>` 默认只检查既有服务和身份。获得本次明确限期授权后，用同一编号加 `--issue` 签发一次；回复丢失或结果未知时只用 `--recover` 取回同一运行，不换编号重签。macOS 使用已有 OpenSSH 身份与严格主机校验，Windows 保留既有 SSH 适配。

Android 使用独立 `phone-android` 写入身份，电脑使用 `pc-query` 只读身份，各固定 24 小时；不撤销或替换鸿蒙身份。凭据只写入受保护的私有目录，公开结果仅保留身份、范围、期限与核验状态。

当前 Android 的「读取电脑登记文件」入口读取 App 专属外部目录 `files/connection-import/material-connection.json`；先核对已有文件归属与期限，再准备本次文件，正常页面核对、勾选允许同步并保存。保存确认后按原文件哈希清理临时导入文件，不清除用户资料或已保存凭据。这里与上方鸿蒙导入路径不同。

实际上传和后台行为须另行验证；签发工具的 `ready` 只表示凭据及服务身份核对通过。资料凭据与 Claude/Codex 的共享 Agent 配对彼此独立，不通过撤销共享配对来结束资料测试。
