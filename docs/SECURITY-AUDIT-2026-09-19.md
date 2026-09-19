# 安全审计记录 2026-09-19 
 
## 结论 
- 应用 git 仓库（D:\Codex Harness Desktop）工作树干净，无未提交代码改动 
- 上次安全修复提交 660634b 已推远程 
 
## 本次审计动作（OS 层，非代码） 
1. 扫描监听端口与进程归属，确认应用 53456 对外暴露 
2. 发现网易 GameViewerServer 绑定 0.0.0.0 + 公网 IPv6，为最大远程攻击面 
3. 确认 53456 为 cloudflared 网页远程隧道目标端口，未误封 
 
## 处置 
- netsh advfirewall 添加 BLOCK_GameViewer_Inbound：封禁 GameViewerServer.exe 全部外部入站 
- 已撤销误加的 BLOCK_Harness_53456_Inbound（避免影响 cloudflared 网页远程） 
- cloudflared 隧道正常，网页远程不受影响 
 
## 遗留建议 
- API key/JWT 明文存储（builtin-plugins.json / openai-accounts.json）建议迁移到系统安全存储 
- 生产环境 approval 不应为 never 
