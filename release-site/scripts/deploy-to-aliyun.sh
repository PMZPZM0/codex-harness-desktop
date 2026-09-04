#!/usr/bin/env bash
# 一键把 release-site 同步到生产服务器 /var/www/codex-harness-releases/
#
# 生产域名：https://www.jvszzp.ltd / https://jvszzp.ltd （Cloudflare CDN 回源；SSH 别名 ch-release，见 ~/.ssh/config）
# 服务器：124.220.63.4（腾讯云 CVM，Ubuntu，ubuntu 用户）
# ⚠️ jvsppl.vip / jvspp.vip = 新加坡服务器 + EdgeOne CDN 的 AI API Gateway，严禁触碰。
# ⚠️ 2026-09-02 实测：jvszzp.ltd/www.jvszzp.ltd 的 DNS 已接入 Cloudflare（橙云代理），https 返回
#    525 = 源站 443 无该域名可用 TLS 证书（Cloudflare 挡 Caddy 的 ACME HTTP-01 自动签证）。
#    服务器 8080 已被 docker「经营罗盘」占用 → release-site 必须用其它端口（远端 .env 的 PORT）。
#    首次部署前必须先登服务器核对 /etc/caddy/Caddyfile + docker 端口，按下面方案接线：
#      方案①（推荐）：Cloudflare SSL/TLS 模式 = Full，源站 Caddy 站点块写 `tls internal` 自签，
#                     reverse_proxy 127.0.0.1:<PORT>；无需申请公网证书。
#      方案②：Caddy 用 DNS-01 challenge（需 xcaddy 编译 cloudflare 插件 + API Token）。
#    两个域名都要配 Caddy vhost（jvszzp.ltd 与 www.jvszzp.ltd 都回源同站）。
#
# Caddy 反代参考（服务器上 /etc/caddy/Caddyfile，按核对后的实际方案填写）：
#   jvszzp.ltd, www.jvszzp.ltd {
#     tls internal
#     reverse_proxy 127.0.0.1:8090
#   }
#
# 在本地 D:/Codex Harness Desktop/release-site/ 跑：
#   bash scripts/deploy-to-aliyun.sh
# 需求：本机有 rsync + ssh（Windows 用 Git Bash 自带），目标机器的 ubuntu 用户可写 /var/www/codex-harness-releases
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-ch-release}"
REMOTE_DIR="${REMOTE_DIR:-/var/www/codex-harness-releases}"
SERVICE_NAME="${SERVICE_NAME:-codex-release-site}"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "[deploy] local: $LOCAL_DIR"
echo "[deploy] remote: ${REMOTE_HOST}:${REMOTE_DIR}"
echo "[deploy] site: https://www.jvszzp.ltd"

ssh "$REMOTE_HOST" "mkdir -p $REMOTE_DIR/data/files $REMOTE_DIR/data/feedback-images"

# 排除：node_modules / 运行时数据 data/（含 releases.json、上传文件、用户截图，全在服务器端维护）
# 以及 .env（用 .env.example 替代）
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude 'data/' \
  --exclude '.env' \
  "$LOCAL_DIR/" "${REMOTE_HOST}:${REMOTE_DIR}/"

# 同步 .env（如果远端没有就拷一份 .env.example）
ssh "$REMOTE_HOST" "[ -f $REMOTE_DIR/.env ] || cp $REMOTE_DIR/.env.example $REMOTE_DIR/.env"

# 首次部署安全：若 .env 仍是默认 admin123，生成随机强密码并轮换（hex 无 sed 特殊字符）
NEW_PW="$(openssl rand -hex 12 2>/dev/null || echo '')"
if [ -n "$NEW_PW" ]; then
  ROTATED="$(ssh "$REMOTE_HOST" "cd $REMOTE_DIR && if grep -q '^ADMIN_PASSWORD=admin123' .env; then sed -i 's/^ADMIN_PASSWORD=admin123/ADMIN_PASSWORD=$NEW_PW/' .env && echo yes; else echo no; fi")"
  if [ "$ROTATED" = "yes" ]; then
    echo "[deploy] ⚠️  管理员密码已轮换为新随机值（请立即保存）: $NEW_PW"
  else
    echo "[deploy] 管理员密码非默认值，保持不动（如需重置请改远端 .env）"
  fi
else
  echo "[deploy] 未生成新密码（缺 openssl），跳过密码轮换；若 .env 为 admin123 请手动改"
fi

echo "[deploy] install deps on remote..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && npm install --omit=dev --no-audit --no-fund"

echo "[deploy] restart service..."
ssh "$REMOTE_HOST" "systemctl restart $SERVICE_NAME 2>/dev/null || (cd $REMOTE_DIR && nohup node server.js > /var/log/${SERVICE_NAME}.log 2>&1 &)"

echo "[deploy] verify..."
ssh "$REMOTE_HOST" "cd $REMOTE_DIR && . ./.env 2>/dev/null; curl -sS http://localhost:\${PORT:-8090}/api/health | head -c 200"
echo
echo "[deploy] done."