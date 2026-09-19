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
 
## 深度扫描·后门专项（同日追加） 
检查面与结论： 
- 代码外连 URL（git grep 全量）：仅飞书/钉钉/GitHub/npm registry/腾讯文档/TAPD 等正常 API，无第三方可疑回传域名  
- 动态代码执行（eval/new Function/atob/Buffer.from）：零命中  
- 子进程调用（spawn/exec/fork）：全部正常用途（引擎/ffmpeg/git/npx/登录），无隐藏回调  
- 硬编码密钥：无（密钥走 encryptedKey 加密字段 + 环境变量注入）  
- 依赖包：主流可信库，无 postinstall 恶意钩子  
- Windows 服务/驱动：无 Codex 相关系统服务，不注册常驻服务  
- git 历史：612 条提交均为正常开发，无异常注入  
- 计划任务/启动项：全部正常软件  
 
结论：未发现后门，代码可信。 
主要风险点：cloudflared 网页远程（53456 经公网隧道暴露，依赖随机 URL+token 保护），建议隧道访问加口令。 
其余为常规加固项（apiKey 明文存储、approval never）。 
