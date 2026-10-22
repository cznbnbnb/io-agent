# 手机任务连接登记文件 v1

2026-10-15，P43正常任务设置的连接导入格式，候选0.1.75。它只登记手机任务身份和明确的既有会话目标，复用现有[任务/请求/答案契约](./README.md)，不创建会话、不提交任务、不启用眼镜输入，也不替代P42运行时会话校验。

文件为UTF-8、最多8192字节的单个JSON对象；恰有以下12个字符串字段，重复键（含转义后重名）、未知字段、非字符串和尾随内容拒绝。不接受资料同步格式或`enabled/create_session`一类隐式授权。

```json
{
  "format": "turboio-task-connection/1",
  "base_url": "https://synthetic.invalid/io-api/v1",
  "owner_id": "synthetic-owner",
  "producer_id": "synthetic-phone",
  "server_id": "synthetic-server",
  "token": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "token_id": "c0ffee00-0000-4000-8000-000000000001",
  "expires_at": "2026-10-15T12:00:00.000Z",
  "computer_id": "synthetic-computer",
  "agent_id": "hermes",
  "project_id": "synthetic-project",
  "session_id": "registered-existing-session"
}
```

示例完全合成，域名/令牌/会话均不表示真实可用。base_url沿用HTTPS任务目标校验，禁止账号、查询串、重定向和路径穿越。四个路由ID为1–128个`A–Z a–z 0–9 _ . -`字符，与当前managed Hermes登记边界一致；它们是明确目标标识，不是路径或执行命令。导入文件中的token_id为UUIDv4，用于核对临时文件归属，不是权限证明；最终权限来自服务器认证。

expires_at使用有效日历的UTC `Z`时间，导入时不得已过期。只读`GET /identity`必须核对schema1.0、owner/producer/server、实际未过期的凭据期限，并与文件期限相等。所需手机权限为`tasks:read/write/update`、`requests:read`、`answers:write`、`messages:receive`。资料只读/写入令牌或Agent令牌不能静默采用为任务令牌。此次预检不证明电脑在线、适配器可执行或目标会话存在。

正常入口“电脑任务→任务设置”提供系统文档选择，以及读取本App私有`files/connection-import/task-connection.json`的电脑登记入口。后者只作为登记交付，不经过任意终端输入；Bearer不进argv、公开日志或仓库。

导入只替换设置草稿，开关置关闭；取消/失败不保存、不启用。用户明确开启并保存时再次核对身份，随后沿用独立AssetStore `turboio.tasks.v1`保存并启动原队列。停用已有连接允许离线保存，避免网络故障阻止暂停。地址或owner/producer/server被改动后，原绑定令牌不沿用；保存令牌不回填密码输入框。手填替换令牌仍需同样预检。

保存成功后，仅在电脑登记文件的token_id、期限、完整目标、route与本次候选和保存快照均一致时移除该临时文件；文件被替换、目标被编辑、无法读回或清理失败时保留并提示。系统选择的用户文档不自动删除。切页/收起/重读取消预检并清空页面临时凭据；迟到响应不能保存或改变新草稿。

登记不续期、不撤销既有令牌、不新建电脑任务，不改变服务器队列Schema。最终投递仍由现有TaskTransport核验身份、固定route、期限、幂等及原问题版本，不能用登记成功关闭P43端到端验收。
