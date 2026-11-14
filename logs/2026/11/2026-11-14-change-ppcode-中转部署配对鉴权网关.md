---
id: 2026-11-14-change-ppcode-中转部署配对鉴权网关
date: 2026-11-14
kind: change
area: remote
title: PPcode 中转部署配对鉴权网关
tags: [relay, deploy, security]
commits: []
files: [scripts/relay-gateway.mjs]
importance: normal
---

# PPcode 中转部署配对鉴权网关

收口上一条事故档案的遗留项：PPcode 自有中转服务器（<服务器地址>）已部署与主仓同版网关（保留本仓 PPcodeRemote 的 APK 默认地址与 RELAY_PATH_PREFIX=/remote/systemd 环境变量），systemd 重启后 active。

部署与验证（只记结论，不记地址/凭据）：
- 旧文件已备份为 relay-gateway.mjs.bak-<时间戳>；新文件 md5 与本地 PP 变体一致，grep PPcodeRemote=1。
- 设备名册清理：removed=7（测试/非规范 ID）、kept=14（真实设备）；同样执行删掉联调用的 feedface11。
- 公网真跑：未签名假隧道的 ok:true 被丢弃（返回「没有电脑响应配对请求」）；同一隧道加上 HMAC 签名后被认可（返回伪造 rid）。验证完已删除测试设备并重启。
- 行为变化：老构建（未签名）的 PPcode 桌面端走「手输 6 位码」会被新网关拒绝；扫码 /t 路径不受影响。桌面端需更新到含 relay-pair-sign 的构建。
