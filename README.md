# 北语校园网

适用于北京语言大学 Dr.COM Web Portal 的 OpenWrt / ImmortalWrt 登录服务，包含 LuCI 页面和命令行客户端。

## 安装和配置

从 [Releases](https://github.com/dreamuniverse843/blcu-portal-openwrt/releases) 下载与你的固件版本和包架构匹配的服务包与 LuCI 包，按附带的 SHA256SUMS 核对。23.05 和 24.10 使用 IPK，25.12 使用 APK。安装时将两个本地包交给同一个包管理器，APK 使用 apk add --allow-untrusted，IPK 使用 opkg install。安装后重启一次 rpcd，使 LuCI 注册新增接口。

1. 打开 LuCI「服务 → 北语校园网 → 设置」，保存账号和密码。在「连接」选项卡选择校园网接口和连接模式。也可在路由器终端运行 blcu-portal configure。
2. 认证服务器 IP 地址支持 IPv4 和 IPv6。若系统 DNS 能正确解析认证域名，可以留空。若 DNS 代理返回合成地址，可填写校园网 DNS 返回的实际地址。客户端访问 Portal 时用 HTTPS 验证域名。
3. 启用「自动检测并重连」。默认每 60 秒检查一次，连续两次确认离线才重登。访问超时时延后检查，认证被拒绝时暂停提交账号。
4. 「连接状态」显示接口、MAC、IP、端口和上次登录时间。「校园网账户」在当前在线账号与已保存账号一致时查询账户数据。

在「设置 → 月度流量计费」填写月免费额度、超额单价和封顶值。额度和单价可分别选 MiB 或 GiB。免费额度和单价填好后，「校园网账户」会根据 Portal 返回的本期累计用量估算超额费用。封顶值留空表示不封顶，填写 0 表示超额免费。估算仅包含按流量产生的费用，账单金额以学校为准。

「连接」支持主动指定 IPv4、IPv6 或双栈。双栈使用同一个校园网账号和同一个实际接口，分别显示 IPv4 与 IPv6 状态。若已有一种地址族在线，自动监测会保留当前会话，另一种地址族可手动发起一次认证。

「日志」在路由器本地保留最近 100 条认证和状态变化记录。设置页可配置更新源和自动检查间隔，支持 GitHub Releases 页面或返回 GitHub Release 格式的 HTTPS JSON 接口。发现新版本会显示发布链接，安装通过包管理器进行。

「连接」中的账号池适合已有多条独立校园网上联的场景。先在「网络 → 接口」创建额外上联，再到「北语校园网 → 连接」在「校园网接口」选择「使用账号池」，保存应用后为各接口绑定不同账号。切换后原先的校园网上联也可以加入，并沿用已保存的主连接账号。也可从「网络 → 接口 → 北语账号池」打开。池中账号沿用主连接的认证服务器与检测参数。可以独立停用某条上联。路由与流量分配使用 OpenWrt 自身的网络配置。

「IPv6」先显示上游 IPv6 地址、默认路由、DNS 和 DHCPv6-PD 委派前缀。获取可下发的前缀后，可为选定的下游 LAN 暂存 SLAAC、SLAAC 加无状态 DHCPv6、或有状态 DHCPv6 配置。核对待应用项后再通过 LuCI 应用。

## 构建与发布

[SDK 构建矩阵](.github/sdk-matrix.json) 为每个支持的 OpenWrt 和 ImmortalWrt 固件版本的每个官方包架构固定一个代表性 SDK，记录目标平台和 SHA-256。相同版本和包架构的设备可以使用同一组产物。运行 `python3 .github/generate-sdk-matrix.py` 可按官方索引重新生成矩阵。主分支推送、PR、手动运行和推送 v 标签都会运行测试并构建全部架构。标签版本与 Makefile 一致时，工作流将产物发到同一个 Release，正文取自 [更新日志](CHANGELOG.md) 的对应版本。

手动使用 SDK 时，将 Makefile、files 和 luci 放入匹配的 SDK 的 package/blcu-portal，安装依赖 feeds 后运行 `make defconfig` 和 `make package/blcu-portal/compile NO_DEPS=1`。软件包保留运行时依赖声明，安装时由路由器的包管理器解析。

build-local-apk.py 可重建用于现场安装的 mipsel_24kc 开发 APK。正式发布由官方 SDK 矩阵生成。

## 验证范围

已在 ImmortalWrt 25.12.1 的 ramips/mt7621 设备验证 IPv4 在线查询及账户查询。IPv6 连接参数和地址核对由自动化测试覆盖。真实首次登录、断线后重连和 IPv6 实际校园网路径仍需现场验证。
