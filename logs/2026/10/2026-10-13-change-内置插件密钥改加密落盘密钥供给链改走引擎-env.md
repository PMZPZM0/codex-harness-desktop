---
id: 2026-10-13-change-内置插件密钥改加密落盘密钥供给链改走引擎-env
date: 2026-10-13
kind: change
area: security
title: 内置插件密钥改加密落盘，密钥供给链改走引擎 env
tags: [security, safeStorage, secret, env]
commits: []
files: []
importance: high
---

# 内置插件密钥改加密落盘，密钥供给链改走引擎 env

# 内置插件密钥改加密落盘，并把密钥供给链改成走引擎 env

## 背景
体检报告 P0-1：`builtin-plugins.json` 里生图插件的 `apiKey` 是**明文**，任何进程 / 截图 /
目录列表 / 备份都能直接读到。而**同一个应用**的 `custom-models.json` 早就走
`safeStorage` 加密（`encryptedKey`）—— 同一条链路两套口径，这条没跟上。

当时我不知道的关键约束（差点只改一半就交）：`resources/tools/harness-media.mjs` 是
**纯 Node 的命令行兜底**（老会话没有 `image_generate` MCP 工具时，模型按
developer_instructions 里的命令行调用它），它**拿不到 Electron 的 safeStorage**。
⇒ 直接把文件改成密文，命令行那条路就再也取不到密钥、彻底生不了图。

该文件里还有一段**声称**「主进程在保存配置时同时写一份引擎可读的明文密钥」的注释 ——
代码里从来没有过这行为（注释声称能力，本项目记录过的最危险假象之一）。

## 结论
**落盘只有密文，明文只存在于内存，命令行另走 env。**

1. `electron/main/09-agents-plugins.ts` 成为该文件的**唯一读写点**：
   - `writeBuiltinPlugins()`：`apiKey` → `safeStorage.encryptString` → `encryptedKey`。
     加密不可用时**退回明文并告警**（宁可存得下，也不能因为加密不可用把用户的密钥吞掉）。
   - `readBuiltinPlugins()`：有 `encryptedKey` 就解密；**没有就原样返回 `apiKey`** ——
     必须容忍存量明文，否则老用户与 `scripts/verify-image-plugin.mjs`（夹具直接写明文）当场崩。
   - `migrateBuiltinPluginSecrets()`：启动自愈，就地升级。**不写 `.bak`**（备份里躺一份明文
     等于没修）；只在加密**确实成功**时才替换，失败原样留着。
   - `builtinPluginEnv()`：内存态 → 密钥环境变量（只给密钥；地址/模型不是秘密）。
2. `electron/features/builtin-ipc.ts`：删掉本域自己的 `JSON.stringify`（那正是明文的老路），
   改调唯一写入点；保存时在 restart **之前**注入 env。
3. `electron/features/boot.ts`：启动跑迁移 + 注入 env（都要在 `server.start()` 之前 ——
   spawn 之后再设对已起的进程无效）。
4. `electron/codex-server.ts`：新增 `builtinEnv` 与 `setBuiltinPluginEnv()`，**单独一格**
   而不是并进 `externalEnv` —— 后者由 connector 在**多处**各自整体替换
   （connectors-ipc / custom-model-apply / boot），并进去会被下一次替换冲掉。
5. `resources/tools/harness-media.mjs`：密钥**优先读 env**、回落读文件明文；
   删掉那句过期的「明文优先」注释。

## 依据
- 提交：桌面版 `0be0228`（PPcode `c924330`、云助手 `e7c9cd3`）。
- 新增守卫 `scripts/guards/12m-builtin-secrets.mjs`（27 项，已进 `npm run check`）：
  静态钉「唯一写入点 / 读取容忍明文 / 迁移在 server.start 之前 / CLI 优先 env」，
  并用夹具 + 假 safeStorage **真跑**全链。硬证据两条：
  「迁移后文件里搜不到 `sk-plain-123`」与「落盘只剩 `encryptedKey`」——
  这是运行期事实，静态看代码看不到。
- `node scripts/verify-image-plugin.mjs` 仍 PASS（命令行兜底路径未被打断）。
- `check-preflight` ✓ 总数 3302 与改动前**完全一致**（新断言都在 check 链的 11s/12m 里，
  不动总账基线），失败仍是既有那 2 项（【130】）。

## 影响面
- 磁盘上不再有明文密钥；引擎进程 env 里有（env 不是"任何进程/目录列表/备份"能拿到的）。
- ⛔ 对照：`nuphus-env.ts` 早就把视觉密钥以 `NUPHUS_MCP_VISION_API_KEY` 走 env 了 ——
  本改动只是把生图那条补齐到同一形态，不是新发明一套。
- ⛔ 版本偏斜：新版 CLI 能读明文（兼容老文件），但**老版 CLI 读不了密文**
  ⇒ 若应用升级而 `resources/tools/harness-media.mjs` 没跟着换，命令行那条路会报"未配置"。
  两者同包分发，正常升级不会出现；手工替换 dist 时要留意。

## 回滚
`writeBuiltinPlugins` 改回写 `apiKey`、删掉迁移调用即可。⛔ 但那样明文会立刻回到磁盘上；
且已加密的存量在回滚后**读不出来**（除非保留解密分支）—— 回滚时务必只回滚写入侧。
