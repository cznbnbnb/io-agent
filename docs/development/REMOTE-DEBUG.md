# 手机远程调试

2026-10-29 当前调试目标已切换到荣耀BRT-AN00（Android17 / SDK37），App仍dev154、完整SHA匹配，没有重装。用户本人完成新手机USB首次授权、Tailscale登录和当前Wi-Fi无线调试授权；新端点序列身份、无线PNG截图、正常唤醒/App启动命令以及Dozing下查询通过，Tailscale系统电池豁免已添加并读回。锁屏设置保持原样，页面操作仍需正常解锁；荣耀OEM自启动、整机重启与新手机异地换Wi-Fi尚未本次验证。实际IP/端口/序列号仍在私有config.json，旧手机配置仅留一份config.previous-phone.json；不自动回退到旧手机或USB。[本批证据](../../rebuild/android-app/new-phone-audit-2026-10-29.json)。

2026-10-23 配置。Mac 与红米使用同一个 Tailscale 账号，通过 Android 的 TLS 无线调试连接。手机有 Wi-Fi 即可，无需 SIM。App 当前版本以 `candidate.json` 的实机安装证据和协作交接顶部为准。

## 离开房间后怎么恢复

1. 手机连接新 Wi-Fi；若网络有网页认证，先完成认证。
2. 打开 Tailscale，确认显示 **Connected**。没有选择 Exit node。
3. 手机「设置 → 更多设置 → 开发者选项 → 无线调试」打开开关，允许当前网络。
4. 将该页 **IP 地址和端口** 一行发给当前开发代理。需要的是这一页的连接端口，不是「使用配对码配对设备」弹窗中的配对端口。

当前手机已验证Mac调试密钥；重新打开无线调试时通常只需更新连接端口。换手机须先完成新手机授权、核对序列并更新私有配置；若新手机要求TLS配对，再按其正常配对流程完成。端口变化时由开发代理更新。开发者选项入口找不到时，可在系统设置搜索「无线调试」。

**旧红米 Android 16 已实测断开再接回 Wi-Fi 会关闭无线调试；新荣耀行为尚未实测。** 本轮实测 Tailscale 自动恢复，`adb_wifi_enabled` 从 1 变 0，正常 UI 重开后端口改变；更新端口即可继续。不能承诺换网、重启或系统回收后完全无人操作恢复。手机重启后如未自动上线，先打开 Tailscale，再完成上面步骤。

## 已完成的配置和验证

- Mac 官方独立版 Tailscale 1.104.2，网络扩展已批准；客户端重开后仍可连接。未启用退出节点、子网路由或 Tailscale SSH；Mac 保留原 DNS。
- 手机官方 Tailscale 1.104.2，VPN 与通知已允许；自启动开启，省电策略为「无限制」。未改 App、眼镜固件、原厂录音设置或已有其他 VPN。
- 两端账号已按用户选择统一到手机账号；账号、实际 IP 与设备序列号仅放本机私有配置。
- 经 Tailscale 地址执行 ADB，核对 `ro.serialno` 与目标红米一致；读回 App dev55，抓取截图字节有效。
- 手机 Home 后熄屏，`mWakefulness=Dozing` 时无线 ADB 仍可用。
- Wi-Fi 断开/接回后 Tailscale 自动恢复，正常 UI 重开无线调试、更新端口并连接成功。
- 用户随后拔线、换 Wi-Fi，并提供新端口；ADB 列表已无 USB、仅剩 Tailscale 端点。再次核对目标序列号、App dev55、有效 PNG 截图和熄屏 Dozing 下远程命令均通过。手机 LAN 地址已变化。首次路径为可路由私网直连；用户再次换 Wi-Fi 后，新端口核对身份及远程 UI 成功，Tailscale ping 确认经香港 DERP 中继、当时未建立直连。
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

## 大安装包的差异传输

完整包约 430 MB。dev56 首次 streamed install 超过工具 5 分钟窗口，未装入手机；不能仅凭这个错误判断卡在传输还是 OEM 安装阶段。可使用 `apk-delta.py` 与 `ApkDelta.java` 减少传输量，**这是开发调试工具，尚不是 App 内远程更新功能**。

1. 持设备锁，读取已安装 APK 的路径和 SHA-256；必须与保留的已装基线一致。核对新包来源、固定签名和回退包。
2. `python3 tools/android/apk-delta.py BASELINE.apk CANDIDATE.apk OUTPUT.delta`。只复用完全相同的压缩数据，ZIP 头、签名块及目录均保留候选原始字节；主机在生成时验证重建哈希。
3. 将 `ApkDelta.java` 用项目 SDK 的 javac/D8 编成临时 DEX，通过已核对身份的 `remote-adb.mjs exec -- push` 传 DEX 和差异文件到 `/data/local/tmp/codex-...`。核对两者传输哈希。
4. 手机 shell 执行 `CLASSPATH=HELPER.dex app_process /system/bin com.turboio.tools.ApkDelta INSTALLED_BASE.apk PATCH.delta OUTPUT.apk EXPECTED_SHA256`。输出与差异文件必须同目录且不能预先存在；错误基线、边界、哈希、截断或多余数据均拒绝，失败删除本次创建的输出。它只重建文件，不安装或启动 App。
5. 独立核对输出 APK SHA-256 与候选一致后，正常 `pm install -r OUTPUT.apk`；按项目约定核对并确认自有安装提示。再核对实际安装路径的哈希、版本、启动与数据保留。不得关闭系统签名验证。
6. 结果确认后清理本次 DEX、差异文件和手机临时完整包；保留当前与回退两个签名包。`python3 tools/android/test-apk-delta.py` 覆盖准确重建、损坏/截断/越界、错误基线及既有文件保护。

## 来源与证据

- [本轮已验证范围](../../rebuild/android-app/remote-debug-setup-2026-10-23.json)
- [Android ADB 官方文档](https://developer.android.com/tools/adb)
- [Android 无线调试实现说明](https://android.googlesource.com/platform/packages/modules/adb/+/HEAD/docs/dev/adb_wifi.md)
- [Tailscale macOS 安装](https://tailscale.com/docs/install/mac)、[Android 安装](https://tailscale.com/docs/install/android)
- [macOS 同类 ADB 错误记录](https://issuetracker.google.com/issues/499752807)
