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
- **重启手机 App 不再重配（11-17 修复）**：手机保存设备秘密，重开时直接 `POST /t/<设备ID>/api/pair`
  （只带 deviceId + deviceSecret）换新 cookie。旧 APK 把 `/t/<设备ID>` 丢了、请求落到根地址，
  根配对原先只收 6 位码 ⇒ 每次重启都失效；网关现支持**设备秘密快路**（问所有在线电脑，
  只认 HMAC 签名过的 `{ok:true,approved:true}`，不广播配对码），电脑全离线时回 `status:"offline"` 让手机重试。
- **旧通道保留**：网关把 `/t/`、`/apk` 以外的请求原样转给 `18092`（原 frp 通道）——
  已经发出去的二维码、旧版 APK 继续可用。

## 手机端

- APK 扫码后**连路径前缀一起存**（`https://域名/t/<设备ID>`）；旧版只存 origin，会在中转路径下 404。
  0.1.17 起 `baseOf()` 显式识别 `/t/<设备ID>`（此前只认 `/r/` 前的前缀，二维码改成 `?p=1` 后前缀被丢掉），
  并在配对成功后从网关下发的 `chm_dev` cookie 补前缀 —— 之后重启直连该电脑，不再落到「只收 6 位码」的根地址。
- 手机页所有接口都拼 `PATH_PREFIX`（`/t/<设备ID>`），直连（局域网/旧固定地址）时前缀为空。
- 安装包可公开下载：手机浏览器打开 `https://remote.ppz123.asia/apk`（网关按  从**各自仓库**的 Release 镜像链拉取并缓存后直发：桌面版/云助手=本仓 ，PPcode=）。
- **0.1.17（11-17）**：`mobile-remote-v0.1.17` 已发布到两个仓的 Release；网关默认 `APK_URL` 指向它，`/apk` 命中本地缓存直接回。
  `RELAY_APK_LOCAL` 保留为应急直发（服务器上放好文件即可，不必等 Release）；桌面端 `/apk` 在中转在线时**优先从网关 `/apk` 取**（仍按 sha256 校验），GitHub 镜像链兜底。

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

## 服务端实际落点（11-27 恢复时核对）

| 件 | 位置 | 备注 |
|---|---|---|
| 网关脚本 | `/opt/relay/relay-gateway.mjs` | 来自本仓 `scripts/relay-gateway.mjs`（唯一源） |
| 依赖 | `/opt/relay/node_modules/ws` | 只有 `ws` 一个依赖 |
| systemd unit | `/etc/systemd/system/relay-gateway.service` | `User=ubuntu` / `Restart=always`；`RELAY_PORT=18700`、`RELAY_STATE=/var/lib/relay/relay-devices.json`、`RELAY_APK_DIR=/var/lib/relay/apk` |
| Caddy 站点 | `/etc/caddy/remote-ppz123.caddy` + `Caddyfile` 里 `import` 一行 | 内容：`import security-headers` + `reverse_proxy 127.0.0.1:18700` |
| 设备表 / 安装包缓存 | `/var/lib/relay/relay-devices.json` · `/var/lib/relay/apk/` | 设备表丢了 = 所有电脑端要重新 TOFU 绑定、手机要重新配对 |

### 故障表现：HTTPS 直接 TLS 报错（alert 80）

11-27 实际事故：**unit 与 Caddy 站点段被删**（`/opt/relay` 与 `relay-gateway.service` 都没了，
`grep remote.ppz123.asia /etc/caddy/*` 为空）。外部表现**不是 404**，而是：

```
SSL3 alert read:fatal:internal error          # openssl s_client
schannel: SEC_E_ILLEGAL_MESSAGE (0x80090326)   # Windows curl
```

同时 `http://` 仍返回 `308 → https` 且 `Server: Caddy` —— Caddy 进程活着，只是没有这个域名的站点/证书。
⇒ 判据：**80 有 Caddy 响应 + 443 握手 internal error = 站点配置缺失**，不是防火墙、不是 DNS、不是证书过期。

恢复三步：装回 unit → 起网关（服务器本机 `curl 127.0.0.1:18700` 应回 503/200 而不是拒绝连接）→
装回 Caddy 站点并 `reload`。证书在 Caddy 存储里仍在（10-28 签发、01-26 到期），站点恢复后无需重签。
自检：`https://<域名>/t/<10位设备ID>/` 应 200（配对页）、`/t/<id>/api/ping` 应 401（未配对）、`/apk` 应 200。


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

## iPhone 主屏幕 Web App（无 Apple 开发者账号）

没有付费 Apple Developer 账号时，不能产出可安装的 IPA。远程页本身是 H5，iPhone 直接用 Safari：

1. 打开电脑端/中转给出的手机地址，完成配对并进入对话页；
2. Safari 分享菜单 →「添加到主屏幕」；
3. 之后从主屏幕图标打开就是独立窗口（无 Safari 地址栏）。

页面已补 `apple-mobile-web-app-capable`、`apple-mobile-web-app-title`、主屏幕图标 `/r/icon.png`；iPhone 上会隐藏 Android「安装包」入口。`/r/icon.png` 免鉴权，只返回本产品图标。
