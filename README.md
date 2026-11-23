# 北语校园网

适用于北京语言大学 Dr.COM Web Portal 的 OpenWrt / ImmortalWrt 登录服务，包含 LuCI 页面和命令行客户端。

## 安装和配置

从 [Releases](https://github.com/dreamuniverse843/blcu-portal-openwrt/releases) 下载与你的固件和目标平台匹配的服务包与 LuCI 包，按附带的 SHA256SUMS 核对。23.05 和 24.10 使用 IPK，25.12 使用 APK。安装时将两个本地包交给同一个包管理器，APK 使用 apk add --allow-untrusted，IPK 使用 opkg install。安装后重启一次 rpcd，使 LuCI 注册新增接口。

1. 打开 LuCI「服务 → 北语校园网 → 设置」，选择校园网接口，保存账号和密码。也可在路由器终端运行 blcu-portal configure。
2. 认证服务器 IP 地址支持 IPv4 和 IPv6。若系统 DNS 能正确解析认证域名，可以留空。若 DNS 代理返回合成地址，可填写校园网 DNS 返回的实际地址。客户端访问 Portal 时用 HTTPS 验证域名。
3. 启用「自动检测并重连」。默认每 60 秒检查一次，连续两次确认离线才重登。访问超时时延后检查，认证被拒绝时暂停提交账号。
4. 「连接状态」显示接口、MAC、IP、端口和上次登录时间。「校园网账户」在当前在线账号与已保存账号一致时查询账户数据。

## 构建与发布

[SDK 构建矩阵](.github/sdk-matrix.json) 固定了官方 SDK 的版本、目标平台和 SHA-256。主分支推送和 PR 运行测试并构建软件包。推送与 Makefile 版本一致的 v 标签后，工作流将矩阵产物发到同一个 Release，正文取自 [更新日志](CHANGELOG.md) 的对应版本。

手动使用 SDK 时，将 Makefile、files 和 luci 放入匹配的 SDK 的 package/blcu-portal，安装依赖 feeds 后运行 make defconfig 和 make package/blcu-portal/compile。

build-local-apk.py 可重建用于现场安装的 mipsel_24kc 开发 APK。正式发布由官方 SDK 矩阵生成。

## 验证范围

已在 ImmortalWrt 25.12.1 的 ramips/mt7621 设备验证 IPv4 在线查询及账户查询。IPv6 连接参数和地址核对由自动化测试覆盖。真实首次登录、断线后重连和 IPv6 实际校园网路径仍需现场验证。
