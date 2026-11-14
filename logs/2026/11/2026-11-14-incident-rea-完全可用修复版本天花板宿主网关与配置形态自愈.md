---
id: 2026-11-14-incident-rea-完全可用修复版本天花板宿主网关与配置形态自愈
date: 2026-11-14
kind: incident
area: devtools
title: REA 完全可用修复：版本天花板、宿主网关与配置形态自愈
tags: [rea, mcp, dynamic-tools, devtools, three-repos]
commits: [59f9e2bc6]
files: [electron/rea-gateway.ts, electron/mcp-bridge.ts, electron/features/boot.ts, electron/features/delegation.ts, electron/features/runtime-ipc.ts, electron/toolchain.ts, scripts/guards/12h-rea-expert.mjs]
importance: high
---

# REA 完全可用修复：版本天花板、宿主网关与配置形态自愈

## 用户令与背景

「那你修一下，完全可用」。此前一轮只读审查判 REA（上游 `morluto/rea` / npm `rea-agents` / MIT）
「不完全可用」，列了三处断点。本轮要把「有条件可用 / 高风险」修到可交付。

**当时不知道、后来被实测推翻的三件事**（这是本条目最该留住的部分）：

1. 审查把 `~/.codex/config.toml` 当成了应用配置，据此断言「外部 npx 段不会自愈」。
   ⛔ 应用真正的 codexHome 是 `electron/runtime-paths.ts:38` 的
   `<userData>/codex-home`（本机 = `%APPDATA%/Codex Harness Desktop/codex-home`）；
   `~/.codex/` 是独立 Codex CLI 的配置，宿主不读写它。审查结论里那段路径**是错的**，
   但「形态漂移判据缺失」这个问题本身仍然成立，所以修复照做。
2. 审查认为「专家能看见、工具却调不到」只是高风险推测，没有 MCP 握手实测。
   本轮实测证实：config.toml 里 `[mcp_servers.rea]` 能 `ready`，但引擎 0.157+ 内置
   MCP 工具**整批延迟暴露**，`ready ≠ 模型可调用`。这是本轮最大的架构性发现。
3. 审查建议「对齐包结构」即可，没料到最新版装完根本起不来：随包内置 Node 是
   `v24.19.0`，而 `rea-agents@6.9.0` 的 engines 是
   `^22.23.4 || ^24.22.1 || >=26.12.1`，`rea.mjs` 的 runtime admission 直接 exit 1。

## 结论

1. **版本天花板**：`REA_PINNED_VERSION = "6.7.0"`（6.7.0 engines
   `^22.19.0 || ^24.11.0 || >=26.0.0`，是与当前内置 Node 兼容的最高版本）。
   同一个常量贯通 `runtime:install`、`UPDATEABLE_TOOLS.pin`、
   `checkRuntimeUpdateRow()`、`performRuntimeUpdate()`、`assertInstallVerified()`；
   界面不再把「已装 6.7.0」误报成「可升级 6.9.0」。
   ⛔ 升级随包 Node 到 ≥24.22.1 后即可删掉 pin、恢复追 latest。
2. **就绪判据**：`reaServerScript()` 三查 `package.json` + `scripts/rea.mjs` +
   `dist/mcp/main.js`。专家门控 `toolAvailable("rea")`、MCP 段生成、网关 spec、
   安装复核共用这一个真相源，半截安装不再被误判可用。
3. **模型侧可达**：只暴露一个宿主 `dynamicTool` 工具 `rea__gateway`
   （`electron/rea-gateway.ts`），用 `action = list | describe | call` 渐进披露
   REA 的 207 个工具。⛔ 不把 207 个工具全量塞进 `thread/start` 的 prompt 前缀。
   网关维持**一条持久 stdio 会话**（复用 `mcp-bridge.openStdio()`），因为 REA 的
   `start_* / resume_* / close_* / frida_*` 是有状态分析，短开短关会丢目标与会话；
   失败只重置会话、⛔ 不自动重试（避免有状态工具被执行两次）。
4. **配置形态自愈**：`reaMcpDrifted(configText, ready)` 纯函数判
   「外部 `cmd.exe /c npx -y rea-agents@… mcp` 形态 / 缺段 / 残留段」，
   纳入 `boot.ts` 的 config drift 重写条件；无自定义模型分支也清掉外部段。
5. **被委派会话**：`delegation.ts` 主进程直发 `thread/start`，不经过 `codex-ipc`
   的 `listMcpDynamicTools` 合并面 ⇒ 显式把 `reaSpec` 加进 `desiredTools`，
   并在 `thread/resume` **之前**同步复用会话的 rollout 首行工具面。

## 依据（怎么验的，不是「测试通过」四个字）

- 版本：`npm view rea-agents@6.9.0 engines`（packument）→ 下载 tarball 读
  `package.json`；用随包 `node.exe` 跑 6.9.0 的 `rea.mjs mcp` 实测
  `initialize timeout` + 退出码 1 + 报错含 `this process runs Node.js 24.19.0`；
  6.5.0 / 6.7.0 各装一次真握手，6.7.0 `tools/list` = **207** 个工具。
- 安装：宿主同款 bundled Node + npm-cli + npmmirror 重装 userData 的半截包，
  `added 11 packages, removed 7 packages, and changed 163 packages`；
  三件（`package.json` / `scripts/rea.mjs` / `dist/mcp/main.js`）齐。
- 编译产物端到端探针（stub Electron `app`，直接 require `dist-electron/*.js`）：
  `REA_PINNED_VERSION=6.7.0`、`REA_GATEWAY_TOOL=rea__gateway`、
  `gateway_command_is_bundled_node=true`、`list_total=207 matched=1`、
  `describe_ok=true has_inputSchema=true`、
  `list_frida_devices ok=true`（返回 local/socket/barebone 三台设备）、
  `list_cutter_sessions ok=true`、`successful_rea_calls=2`、
  `session_alive_after_calls=true`、
  `rea_gateway_in_surface=true` / `dynamicTool_shape_ok=true` /
  `resolveMcpTool_ok=true` / `handle_call_via_bridge_ok=true` /
  `expert_toolAvailable_rea=true`。
  ⛔ 另有反例：`current_address` 在无目标时返回 REA 自己的
  `target_unavailable` 结构化错误 —— 这是**路由成功的证据**，不是网关失败。
- 配置自愈：`%APPDATA%/…/codex-home/config.toml` 的 rea 段备份后注入外部形态，
  重启应用 2 秒内收敛回宿主形态（bundled `node.exe` + 绝对路径 `rea.mjs`）。
  启动日志 `[mcp-diag] … "name":"rea","status":"ready"`。
  ⛔ 这次重写同时被 `providerOutdated=true` 与更早的 cloud-models 重写触发，
  所以**另外**在编译产物上取出重写条件表达式、注入受控布尔真跑 5/5（含两组对照组）：
  宿主形态+包就绪 ⇒ 不重写；外部形态+包就绪（唯一条件）⇒ 重写；
  缺段+包就绪 ⇒ 重写；残留段+包未就绪 ⇒ 重写；无段+包未就绪 ⇒ 不重写。
- 守卫/构建：`npm run check` → `预检通过（5 条告警，见上）`、退出码 0，
  尾部【93】【94】【96】【288】真跑；`12h-rea-expert 47/47`、
  `12aj-filee 27/27`、`11f 197/197`、`【265】棘轮 变长：无`。
  `npm run build` 通过，主产物 `dist/assets/index-D11fRbGy.js`。
- 界面验收（computer use，非 CDP 探针）：头像 →「检查更新」读到
  `v0.0.58` / `构建 20261114-1004` / `产物 index-D11fRbGy.js`，
  与磁盘 `ls -t dist/assets/index-*.js` **逐字一致**；
  `taskkill //IM electron.exe //T //F` 后 `tasklist` 无残留。

## 影响面

- 「洞见」专家（`requiresTool: "rea"`）在包就绪后出现，且能真正调 REA 工具；
  被委派的专家/子智能体会话同样可用。
- 「开发工具」页 REA 卡片文案改成「版本锁定在随包 Node 的兼容上限」；
  更新链不再追 latest（这是**行为语义变化**，用户能感知）。
- `mcp-bridge.ts` 导出 `StdioSession` / `openStdio()`，其它 stdio 连接器不受影响；
  网关不写连接器缓存，包未装时工具面干净消失。
- `config.toml` 每次启动可能整份重写（既有行为，本轮只加一条判据）。
- 守卫：`12h-rea-expert` 27→47 条；`11f` / `11-config-keys` /
  `07-turn-fold/part-03` / `04-misc-and-tools` / `12aj-filee` 的旧字面量判据
  改锚真实语义；`09-structural` 棘轮按实测净行记账
  （boot 1206 / runtime-ipc 1121 / vite-env.d.ts 1113）。
- ⛔ 并行线：ApkStart 把 GitHub 直下型改成表驱动、gen:ipc 让
  `src/vite-env.d.ts` +1 净行，这些不是本线改动，但守卫基线必须按实测同步；
  `src/lib/extensibility-catalog.mjs`、`src/lib/team-templates.*`、
  `src/features/harness-team/12-team-create.tsx` 均未纳入本线提交。

## 回滚

- 代码：`git revert 59f9e2bc6`（单笔提交；`electron/rea-gateway.ts` 是新增文件，
  revert 会整份删除）。
- 运行时数据：userData 里的 `rea-agents` 包无需回滚（6.7.0 与宿主兼容）；
  若必须回到未装状态，「设置 → 开发工具 → REA 逆向分析」卸载即可，
  `reaGatewaySpec()` 会返回 null，工具面自动消失。
- `config.toml`：回滚代码后若仍留宿主形态段，下次启动由 `ownedMcpServers`
  重写收敛；外部形态段不会被本轮逻辑再改写（判据已删）。
- ⛔ 不确定：三仓同步后云助手侧是否还需要部署，取决于同步面是否含 `src/**`；
  本轮改动全在 `electron/` 与 `scripts/guards/`，按判定表**不触发**云端界面部署。
