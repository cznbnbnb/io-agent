# 手机远程调试

2026-10-23 配置。Mac 与红米使用同一个 Tailscale 账号，通过 Android 的 TLS 无线调试连接。手机有 Wi-Fi 即可，无需 SIM。当前 App 保持 dev55 /10477。

## 离开房间后怎么恢复

1. 手机连接新 Wi-Fi；若网络有网页认证，先完成认证。
2. 打开 Tailscale，确认显示 **Connected**。没有选择 Exit node。
3. 手机「设置 → 更多设置 → 开发者选项 → 无线调试」打开开关，允许当前网络。
4. 将该页 **IP 地址和端口** 一行发给当前开发代理。需要的是这一页的连接端口，不是「使用配对码配对设备」弹窗中的配对端口。

Mac 已有配对，本轮重新打开无线调试后无需重复输入配对码。端口变化时由开发代理更新。开发者选项入口找不到时，可在系统设置搜索「无线调试」。

**这部 Android 16 手机断开再接回 Wi-Fi 会关闭无线调试。** 本轮实测 Tailscale 自动恢复，`adb_wifi_enabled` 从 1 变 0，正常 UI 重开后端口改变；更新端口即可继续。不能承诺换网、重启或系统回收后完全无人操作恢复。手机重启后如未自动上线，先打开 Tailscale，再完成上面步骤。

## 已完成的配置和验证

- Mac 官方独立版 Tailscale 1.104.2，网络扩展已批准；客户端重开后仍可连接。未启用退出节点、子网路由或 Tailscale SSH；Mac 保留原 DNS。
- 手机官方 Tailscale 1.104.2，VPN 与通知已允许；自启动开启，省电策略为「无限制」。未改 App、眼镜固件、原厂录音设置或已有其他 VPN。
- 两端账号已按用户选择统一到手机账号；账号、实际 IP 与设备序列号仅放本机私有配置。
- 经 Tailscale 地址执行 ADB，核对 `ro.serialno` 与目标红米一致；读回 App dev55，抓取截图字节有效。
- 手机 Home 后熄屏，`mWakefulness=Dozing` 时无线 ADB 仍可用。
- Wi-Fi 断开/接回后 Tailscale 自动恢复，正常 UI 重开无线调试、更新端口并连接成功。
- 用户随后拔线、换 Wi-Fi，并提供新端口；ADB 列表已无 USB、仅剩 Tailscale 端点。再次核对目标序列号、App dev55、有效 PNG 截图和熄屏 Dozing 下远程命令均通过。手机 LAN 地址已变化。本轮路径仍为可路由的私网直连，尚无异地跨公网或 DERP 中继的 ADB 实测。
- 系统 VPN 设置要求先设置锁屏密码，已取消该提示；未修改密码，未设置 Android「始终开启 VPN」。自启动和后台无限制已实际配置；整机重启和长时待机仍待验证。

## 开发代理命令

在自己的 Codex 工作区执行；先拿共享设备锁，结束释放。工具不会自动抢锁，也不会回退到 USB 或其他设备。

```sh
node tools/collab/device-lock.mjs acquire --owner codex --minutes 30 --purpose "远程调试 dev55"
node tools/android/remote-adb.mjs connect
node tools/android/remote-adb.mjs status
node tools/android/remote-adb.mjs exec -- shell getprop ro.product.model
node tools/collab/device-lock.mjs release --owner codex
```

手机给出新连接端口时，用其实际数值替换下面的 `PORT`：

```sh
node tools/android/remote-adb.mjs connect --port PORT
```

工具仅在目标手机序列号核对成功后保存新端口。错误端口、离线、账号未连接、设备锁失效、设备不匹配均停止；不扫描网络。日志、截图、安装等用 `exec --` 选择具体设备子命令。命令输出可能含用户资料，照常只保存到私有目录，勿贴进公开文档。

私有配置：`rebuild/android-app/.private/remote-debug/config.json`（权限 0600，共享 `.private` 根）。结构如下，示例不是实际设备：

```json
{
  "schema": 1,
  "tailscale_ip": "100.64.1.2",
  "port": 12345,
  "expected_serial": "verified-device-serial",
  "tailscale_cli": "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
}
```

必须先核对物理设备，再登记该配置。工具只接受 Tailscale 的 100.64.0.0/10 IPv4。已配对的 ADB 密钥保存在原用户的 `.android` 中，不复制到仓库。没有开放公网 ADB、配置端口转发或启用 `adb tcpip 5555`。

## 故障处理

| 现象 | 处理 |
| --- | --- |
| Tailscale 未运行 | 检查两端客户端、同一账号、Wi-Fi 网页认证及登录状态。 |
| Tailscale 已连接，ADB 离线 | 检查手机无线调试开关和当前连接端口；换网后不能沿用旧端口。 |
| `protocol fault` / `No route to host` | 核对 `adb server-status` 的实际程序及日志。本轮发现旧后台进程无法访问 LAN，但普通 TCP 可达；持设备锁且没有其他设备任务后重启 ADB server，恢复正常。不要删除已有配对密钥或把此错误一概当错码。 |
| 设备锁被 Claude 持有 | 等待或做不碰设备的工作，不抢锁、不删锁。 |
| 应用安装需要手机确认 | 按项目安装约定，核对自有安装包后处理真实安装窗口。无线传输成功不保证 OEM 自动允许安装。 |

停用远程调试：手机关闭无线调试，再断开 Tailscale 即可。不需要卸载项目 App 或清除数据。

## 来源与证据

- [本轮已验证范围](../../rebuild/android-app/remote-debug-setup-2026-10-23.json)
- [Android ADB 官方文档](https://developer.android.com/tools/adb)
- [Android 无线调试实现说明](https://android.googlesource.com/platform/packages/modules/adb/+/HEAD/docs/dev/adb_wifi.md)
- [Tailscale macOS 安装](https://tailscale.com/docs/install/mac)、[Android 安装](https://tailscale.com/docs/install/android)
- [macOS 同类 ADB 错误记录](https://issuetracker.google.com/issues/499752807)
