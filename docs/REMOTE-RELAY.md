# 手机远控：内置中转（装完即用）

> 2026-10-29 立项。目标：**用户装完 App 就能用**，不再需要人工装 frpc、也不需要在服务器手工配一条通道。

## 链路

```
手机浏览器/App
   │  https://remote.ppz123.asia/t/<设备ID>/r/mobile
   ▼
Caddy（服务器，终止 TLS；/t/ 与 /apk 之外仍反代旧端口，见下）
   ▼
relay-gateway.mjs（服务器 127.0.0.1:18700，systemd: relay-gateway）
   │  WebSocket（电脑端主动连出，服务器不主动连电脑）
   ▼
电脑端 App 内置隧道（electron/relay-tunnel.ts）
   ▼
本机远控服务 127.0.0.1:17891（remote.ts）
```

- **设备 ID**：每台电脑首次运行时生成 10 位随机 ID + 64 位令牌，存 `userData/relay-device.json`；
  ID 重启不变（手机靠它找到这台电脑），令牌只用于证明"我是这台"。
- **TOFU 绑定**：网关第一次见到某个 ID 时记下令牌哈希（`/var/lib/relay/relay-devices.json`），
  之后令牌不一致直接拒（防冒用 ID）。
- **令牌不进 URL**：WebSocket 连上后第一帧 `hello` 里带令牌（查询串会进 Caddy/nginx 访问日志）。
- **配对仍然不变**：手机第一次连要输电脑上显示的 6 位配对码 + 电脑端批准；批准后种 HttpOnly cookie。
- **旧通道保留**：网关把 `/t/`、`/apk` 以外的请求原样转给 `18092`（原 frp 通道）——
  已经发出去的二维码、旧版 APK 继续可用。

## 手机端

- APK 扫码后**连路径前缀一起存**（`https://域名/t/<设备ID>`）；旧版只存 origin，会在中转路径下 404。
- 手机页所有接口都拼 `PATH_PREFIX`（`/t/<设备ID>`），直连（局域网/旧固定地址）时前缀为空。
- 安装包可公开下载：手机浏览器打开 `https://remote.ppz123.asia/apk`（网关 302 到 GitHub Release）。

## 服务端部署

```bash
# 1) 代码与依赖（网关只用 ws）
sudo mkdir -p /opt/relay/node_modules
scp scripts/relay-gateway.mjs server:/opt/relay/
scp -r node_modules/ws server:/opt/relay/node_modules/ws
sudo mkdir -p /var/lib/relay && sudo chown ubuntu:ubuntu /var/lib/relay

# 2) systemd（Restart=always；环境变量见 /etc/systemd/system/relay-gateway.service）
sudo systemctl enable --now relay-gateway

# 3) Caddy：把 remote.ppz123.asia 反代到 127.0.0.1:18700（网关内部再转 18092 旧通道）
sudo cp /etc/caddy/remote-ppz123.caddy /etc/caddy/remote-ppz123.caddy.bak
sudo sed -i 's/127.0.0.1:18092/127.0.0.1:18700/' /etc/caddy/remote-ppz123.caddy
sudo systemctl reload caddy
```

可选环境变量：`RELAY_PORT`（默认 18700）、`RELAY_HOST`、`RELAY_LEGACY_TARGET`（默认 127.0.0.1:18092）、
`RELAY_STATE`、`RELAY_APK_URL`（默认指向 `mobile-remote-v0.1.2` 的 CodexRemote 资产）。

## 电脑端（为什么不需要装 frpc 了）

`remote.ts` 在远控服务起来后启动内置隧道；配对地址优先级：

1. **中转在线** → `https://<域名>/t/<设备ID>`（产品路径）
2. 固定公网地址（`HARNESS_REMOTE_PUBLIC_URL` / `remote-public-url.txt`，自建通道的老用户）
3. cloudflared 临时隧道
4. 局域网 IPv4

中转离线时自动回退到 2/3/4，二维码不会指向死地址；远控设置页有一行状态（在线/连接中/离线 + 原因）。

## 已知边界

- 网关只转发 HTTP；手机页的事件走 1.5s 轮询（原来的 WebSocket 从未挂处理器，已删除）。
- 同一手机连两台电脑时，cookie 由网关改写为 `Path=/t/<设备ID>`，互不覆盖。
- 中转服务器能看到转发流量（隐私说明需在协议/帮助里写明）；网关有限速、并发上限与体积上限。
- 未来换域名/换版本：改 `RELAY_DEFAULT_BASE`（remote.ts）、`APK_URL`（网关环境变量）与 APK 内置地址三处。
